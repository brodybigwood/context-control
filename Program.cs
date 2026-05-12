using Microsoft.EntityFrameworkCore;

var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY") 
    ?? throw new Exception("OPENAI_API_KEY not set");

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite("Data Source=app.db"));


var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/conversations/{id}/messages", async (int id, MessageRequest req, AppDbContext db, HttpContext http) =>
{
    // save user message
    var userMessage = new Message
    {
        ConversationId = id,
        ParentMessageId = req.ParentMessageId,
        Role = "user",
        Content = req.Content
    };
    db.Messages.Add(userMessage);
    await db.SaveChangesAsync();

    // build context chain by walking up parent tree
    var contextMessages = new List<Message>();
    var current = userMessage;
    while (current != null)
    {
        contextMessages.Insert(0, current);
        current = current.ParentMessageId.HasValue
            ? await db.Messages.FindAsync(current.ParentMessageId.Value)
            : null;
    }

    // SSE setup
    http.Response.Headers["Content-Type"] = "text/event-stream";
    http.Response.Headers["Cache-Control"] = "no-cache";
    http.Response.Headers["X-Accel-Buffering"] = "no";

    // call OpenAI
    var client = new HttpClient();
    client.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");

    var requestBody = new
    {
        model = req.Model ?? "gpt-4o",
        stream = true,
        messages = contextMessages.Select(m => new { role = m.Role, content = m.Content })
    };

    var response = await client.PostAsJsonAsync("https://api.openai.com/v1/chat/completions", requestBody);
    var stream = await response.Content.ReadAsStreamAsync();
    var reader = new StreamReader(stream);

    var assistantContent = new System.Text.StringBuilder();

    while (!reader.EndOfStream)
    {
        var line = await reader.ReadLineAsync();
        if (string.IsNullOrEmpty(line) || !line.StartsWith("data: ")) continue;
        var data = line["data: ".Length..];
        if (data == "[DONE]") break;

        var json = System.Text.Json.JsonDocument.Parse(data);
        var delta = json.RootElement
            .GetProperty("choices")[0]
            .GetProperty("delta");

        if (delta.TryGetProperty("content", out var tokenEl))
        {
            var token = tokenEl.GetString() ?? "";
            assistantContent.Append(token);
            await http.Response.WriteAsync($"data: {token}\n\n");
            await http.Response.Body.FlushAsync();
        }
    }

    // save assistant message
    var assistantMessage = new Message
    {
        ConversationId = id,
        ParentMessageId = userMessage.Id,
        Role = "assistant",
        Content = assistantContent.ToString()
    };
    db.Messages.Add(assistantMessage);
    await db.SaveChangesAsync();
});

app.MapPost("/conversations", async (AppDbContext db) =>
{
    var conversation = new Conversation { Title = "New conversation" };
    db.Conversations.Add(conversation);
    await db.SaveChangesAsync();
    return Results.Ok(conversation);
});

app.MapPost("/messages/{id}/fork", async (int id, AppDbContext db) =>
{
    var message = await db.Messages.FindAsync(id);
    if (message is null) return Results.NotFound();

    var forkedConversation = new Conversation
    {
        Title = "Fork",
        ForkedFromMessageId = id,
        ForkedFromConversationId = message.ConversationId
    };
    db.Conversations.Add(forkedConversation);
    await db.SaveChangesAsync();

    return Results.Ok(new { forkedConversationId = forkedConversation.Id, forkedFromMessageId = id });
});

app.MapGet("/health", () => "ok");

app.MapGet("/conversations", async (AppDbContext db) =>
{
    var conversations = await db.Conversations
        .OrderByDescending(c => c.CreatedAt)
        .ToListAsync();

    var result = await Task.WhenAll(conversations.Select(async c =>
    {
        string? preview = null;
        if (c.ForkedFromMessageId.HasValue)
        {
            var msg = await db.Messages.FindAsync(c.ForkedFromMessageId.Value);
            preview = msg?.Content.Length > 80 ? msg.Content[..80] : msg?.Content;
        }
        return new
        {
            c.Id,
            c.UserId,
            c.Title,
            c.ForkedFromMessageId,
            c.ForkedFromConversationId,
            c.CreatedAt,
            ForkedFromMessagePreview = preview
        };
    }));

    return Results.Ok(result);
});

app.MapGet("/conversations/{id}/messages", async (int id, AppDbContext db) =>
{
    var messages = await db.Messages
        .Where(m => m.ConversationId == id)
        .OrderBy(m => m.CreatedAt)
        .ToListAsync();
    return Results.Ok(messages);
});

app.MapDelete("/conversations/{id}", async (int id, AppDbContext db) =>
{
    var convo = await db.Conversations.FindAsync(id);
    if (convo is null) return Results.NotFound();

    var messages = db.Messages.Where(m => m.ConversationId == id);
    db.Messages.RemoveRange(messages);
    db.Conversations.Remove(convo);
    await db.SaveChangesAsync();

    return Results.Ok();
});



// push a new frame
app.MapPost("/conversations/{id}/frames", async (int id, FrameRequest req, AppDbContext db) =>
{
    var frame = new Frame
    {
        ConversationId = id,
        StartMessageId = req.StartMessageId
    };
    db.Frames.Add(frame);
    await db.SaveChangesAsync();
    return Results.Ok(frame);
});

// get all frames for a conversation
app.MapGet("/conversations/{id}/frames", async (int id, AppDbContext db) =>
{
    var frames = await db.Frames
        .Where(f => f.ConversationId == id)
        .OrderBy(f => f.CreatedAt)
        .ToListAsync();
    return Results.Ok(frames);
});

// pop the deepest frame
app.MapDelete("/conversations/{id}/frames/active", async (int id, AppDbContext db) =>
{
    var frame = await db.Frames
        .Where(f => f.ConversationId == id)
        .OrderByDescending(f => f.CreatedAt)
        .FirstOrDefaultAsync();

    if (frame is null) return Results.NotFound();

    // delete all messages after the frame start
    var messagesToDelete = await db.Messages
        .Where(m => m.ConversationId == id && m.Id > frame.StartMessageId)
        .ToListAsync();
    db.Messages.RemoveRange(messagesToDelete);

    db.Frames.Remove(frame);
    await db.SaveChangesAsync();

    return Results.Ok();
});




app.Run();

public record MessageRequest(string Content, int? ParentMessageId, string? Model);
public record FrameRequest(int StartMessageId);
