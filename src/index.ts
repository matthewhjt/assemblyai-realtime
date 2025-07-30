import express from "express";
import dotenv from "dotenv";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { AssemblyAI, RealtimeTranscript } from "assemblyai";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY!,
});

app.use(express.json());

app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

wss.on("connection", async (ws) => {
  console.log("Client connected");

  const transcriber = client.streaming.transcriber({
    sampleRate: 16000,
    formatTurns: true,
  });

  transcriber.on("open", ({ id }) => {
    console.log(`Session opened with ID: ${id}`);
  });

  transcriber.on("error", (error) => {
    console.error("AssemblyAI error:", error);
  });

  transcriber.on("close", (code, reason) => {
    console.log("AssemblyAI session closed:", code, reason);
  });

  transcriber.on("turn", (turn) => {
    if (!turn.transcript) {
      return;
    }

    if (turn.end_of_turn && turn.turn_is_formatted) {
      console.log("Formatted transcript:", turn.transcript);
      ws.send(
        JSON.stringify({
          text: turn.transcript,
          start: turn.words[0].start / 1000,
          end: turn.words[turn.words.length - 1].end / 1000,
        })
      );
    }
  });

  await transcriber.connect();

  ws.on("message", (data) => {
    const MIN_CHUNK_SIZE = 1600;
    const MAX_CHUNK_SIZE = 32000;
    const buffer = Buffer.from(data as ArrayBuffer);
    console.log(
      `Received audio data size: ${buffer.length} (${(buffer.length / 32).toFixed(1)}ms)`
    );
    for (let i = 0; i < buffer.length; i += MAX_CHUNK_SIZE) {
      let chunk = buffer.subarray(i, i + MAX_CHUNK_SIZE);

      if (chunk.length > 0) {
        if (chunk.length < MIN_CHUNK_SIZE) {
          const paddingSize = MIN_CHUNK_SIZE - chunk.length;
          const silence = Buffer.alloc(paddingSize, 0);
          chunk = Buffer.concat([chunk, silence]);
          console.log(
            `Padded chunk from ${buffer.length} to ${chunk.length} bytes with silence`
          );
        }

        const chunkDurationMs = (chunk.length / (16000 * 2)) * 1000;

        transcriber.sendAudio(chunk);
        console.log(
          `Sent chunk size: ${chunk.length} (${chunkDurationMs.toFixed(1)}ms)`
        );
      }
    }
  });

  ws.onclose = () => {
    console.log("Client disconnected");
    transcriber.close();
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    transcriber.close();
  };
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
