# Context Control GPT Wrapper

A lightweight chat system that integrates GPT-like assistant responses, with conversation management, message forking, and frames for snapshotting.

## Features

- Store conversations and messages in a local SQLite database
- Fork messages into new conversations
- Context-aware conversation threads
- Frames: snapshot and undo portions of conversations
- Real-time assistant responses via Server-Sent Events (SSE)
- Minimal frontend with sidebar, chat area, and input

## Tech Stack

- **Backend:** ASP.NET Core Minimal API
- **Database:** SQLite via Entity Framework Core
- **Frontend:** HTML, CSS, JavaScript
- **Libraries:** Marked.js (Markdown), KaTeX (Math rendering)

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/brodybigwood/context-control.git
   cd context-control
   ```

2. Set your OpenAI API key:

   ```bash
   export OPENAI_API_KEY=your_api_key_here
   ```

3. Restore dependencies and run:

   ```bash
   dotnet restore
   dotnet run
   ```

4. Open `http://localhost:5000` in your browser.

## Usage

* Click **New chat** to start a conversation
* Send messages to the assistant
* Fork messages to create new conversations
* Use frames to snapshot and undo message sequences

## Notes

* Local SQLite database: `app.db` (do not commit)
* Dev settings: `appsettings.Development.json` (do not commit)
* SSE streams assistant responses in real-time
