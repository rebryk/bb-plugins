import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const executionSchema = z.object({ providerId: z.string(), model: z.string(), reasoningLevel: z.string().optional() });
export const agentSchema = z.object({
  id: z.string(), name: z.string(), avatar: z.string(), instructions: z.string(),
  projectId: z.string().nullable(), threadId: z.string().nullable(),
  execution: executionSchema.nullable(),
});
export type Agent = z.infer<typeof agentSchema>;
export const taskSchema = z.object({
  id: z.string(), agentId: z.string(), threadId: z.string().nullable(), title: z.string(),
  projectId: z.string(), projectName: z.string(),
  state: z.enum(['queued', 'running', 'needs-you', 'done', 'snoozed']),
  ask: z.string().nullable(), needsSince: z.number().nullable(), etaAt: z.number().nullable(),
  completed: z.number(), total: z.number(), runningAgents: z.number(),
  snoozeUntil: z.number().nullable(), updatedAt: z.number(),
  pendingWorkers: z.array(z.object({ threadId: z.string(), title: z.string() })),
  execution: executionSchema.nullable(), routingReason: z.string().nullable(),
  artifacts: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type Task = z.infer<typeof taskSchema>;
export const agentInputSchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(60),
  avatar: z.string().max(150000).default(''), instructions: z.string().max(12000).default(''),
  projectId: z.string().nullable().default(null), execution: executionSchema.nullable().default(null),
});
export const rpcContract = defineRpcContract({
  board: { input: z.null(), output: z.object({ agents: z.array(agentSchema), tasks: z.array(taskSchema), runningAgents: z.number() }) },
  openAgent: { input: z.object({ agentId: z.string() }), output: z.object({ threadId: z.string() }) },
  saveAgent: { input: agentInputSchema, output: agentSchema },
  completeTask: { input: z.object({ taskId: z.string() }), output: z.null() },
  snoozeTask: { input: z.object({ taskId: z.string(), until: z.number().nullable() }), output: z.null() },
  reopenTask: { input: z.object({ taskId: z.string() }), output: z.null() },
});
export const CHANGED = 'agents-changed';
