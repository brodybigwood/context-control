using Microsoft.EntityFrameworkCore;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Frame> Frames => Set<Frame>();
}

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Conversation
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Title { get; set; } = "";
    public int? ForkedFromMessageId { get; set; }
    public int? ForkedFromConversationId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Message
{
    public int Id { get; set; }
    public int ConversationId { get; set; }
    public int? ParentMessageId { get; set; }
    public string Role { get; set; } = "";
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Frame
{
    public int Id { get; set; }
    public int ConversationId { get; set; }
    public int StartMessageId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
