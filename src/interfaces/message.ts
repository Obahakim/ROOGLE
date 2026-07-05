/**
 * src/interfaces/message.ts
 *
 * Core TypeScript interfaces and types used throughout ROOGLE.
 *
 * These types are deliberately simple and focused on natural conversation.
 * They must work for both the iframe experience and DM bots.
 */

// ============================================
// Basic Conversation Types
// ============================================

export interface UserMessage {
  role: 'user';
  content: string;
  language?: string; // e.g. 'en', 'es', 'zh' — ROOGLE should support any
  timestamp?: Date;
}

export interface AgentMessage {
  role: 'assistant';
  content: string;
  timestamp?: Date;
}

// ============================================
// Tool Related Types
// ============================================

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
}

// ============================================
// Tool Definition (used by registry)
// ============================================

export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, any>; // Zod schema or JSON schema in future
  execute: (args: Record<string, any>) => Promise<any>;
}

// ============================================
// Handoff / Specialist Routing
// ============================================

export interface SpecialistHandoff {
  targetAgentId: string;
  targetAgentName?: string;
  reason: string; // Why ROOGLE chose this specialist (plain English)
  context: string; // Clean summary of what the user wants
}

// ============================================
// Full Response from ROOGLE
// ============================================

export interface RoogleResponse {
  message: string; // The friendly message shown to the user (clean, no tool names)
  thoughts?: string; // Internal reasoning - only for debug / expandable section. Never shown in main response.
  toolCalls?: ToolCall[]; // Internal use only
  handoff?: SpecialistHandoff;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}
