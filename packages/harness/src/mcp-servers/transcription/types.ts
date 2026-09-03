
import { McpNotification } from "@fondamenta/mcp-core";

export interface TranscriptionNotification extends McpNotification {
  method: 'transcription/ready';
  params: {
    text: string;
    language?: string;
    duration: number;
    transcriber: string;
  };
};
