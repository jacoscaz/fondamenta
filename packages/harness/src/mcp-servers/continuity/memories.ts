// import { McpServer } from "@fondamenta/mcp-core";
// import { DB } from "../../database/client.js";
// import {
//   countRecords,
//   deleteRecord,
//   insertRecord,
//   selectRecords,
//   updateRecord,
//   SelectableContinuityRecord,
// } from "../../database/tables/continuity_records.js";
// import { type HarnessMcpToolCallContext } from "../types.js";

// // ── Param interfaces ──

// interface CountMemoriesParams {
//   session_id?: number;
//   from?: string;
//   to?: string;
//   match?: string;
// }

// interface SelectMemoriesParams extends CountMemoriesParams {
//   id?: number | number[];
//   offset?: number;
//   limit?: number;
//   search?: string;
//   order?: 'creation_date_asc' | 'creation_date_desc';
// }

// interface InsertMemoryParams {
//   data: string;
// }

// interface UpdateMemoryParams {
//   memory_id: number;
//   data: string;
// }

// interface DeleteMemoryParams {
//   memory_id: number;
// }

// // ── Formatters ──

// const formatMemory = (m: SelectableContinuityRecord): string => {
//   return `## memory #${m.id}\n\ncreated at: ${m.created_at.toISOString()}\n\n${m.content}`;
// };

// const formatMemories = (memories: SelectableContinuityRecord[]): string => {
//   return `\`\`\`# Memories\n\n${memories.map(formatMemory).join('\n\n')}\n\`\`\``;
// };

// // ── Tool registration ──

// const TYPE = 'memory' as const;
// const MAX_MEMORY_LENGTH = 400;

// export const registerMemoryTools = async (db: DB, mcp: McpServer<HarnessMcpToolCallContext>) => {

//   mcp.addTool<InsertMemoryParams>(
//     'memory_insert',
//     'Memory - Insert',
//     'Allows you to persist memories for later recall across sessions',
//     async ({ data }, { session }) => {
//       if (data.length > MAX_MEMORY_LENGTH) {
//         return [{ type: "text", text: `Memory exceeds ${MAX_MEMORY_LENGTH} characters (${data.length} provided). Distill to essential significance.` }];
//       }
//       await insertRecord(db, {
//         type: TYPE,
//         session_id: session.id,
//         content: data,
//       });
//       return [{ type: "text", text: 'Memory inserted correctly' }];
//     },
//   );

//   mcp.addTool<SelectMemoriesParams>(
//     'memory_select',
//     'Memory - Select',
//     'Allows you to query memories that you have previously persisted',
//     async (params) => {
//       const order_dir = params.order === 'creation_date_desc'
//         ? 'desc' as const
//         : 'asc' as const;
//       const memories = await selectRecords(db, {
//         type: TYPE,
//         session_id: params.session_id,
//         from: params.from ? new Date(params.from) : undefined,
//         to: params.to ? new Date(params.to) : undefined,
//         match: params.match,
//         id: params.id,
//         offset: params.offset,
//         limit: params.limit,
//         search: params.search,
//         order_col: 'created_at',
//         order_dir,
//       });
//       return [{ type: "text", text: formatMemories(memories) }];
//     },
//   );

//   mcp.addTool<DeleteMemoryParams>(
//     'memory_delete',
//     'Memory - Delete',
//     'Allows you to delete memories that you have previously persisted',
//     async ({ memory_id }) => {
//       await deleteRecord(db, memory_id);
//       return [{ type: "text", text: 'Memory deleted correctly' }];
//     },
//   );

//   mcp.addTool<UpdateMemoryParams>(
//     'memory_update',
//     'Memory - Update',
//     'Allows you to update the content of an existing memory',
//     async ({ memory_id, data }) => {
//       await updateRecord(db, memory_id, { content: data });
//       return [{ type: "text", text: 'Memory updated correctly' }];
//     },
//   );

//   mcp.addTool<CountMemoriesParams>(
//     'memory_count',
//     'Memory - Count',
//     'Count memories matching the specified filters',
//     async (params) => {
//       const count = await countRecords(db, {
//         type: TYPE,
//         session_id: params.session_id,
//         from: params.from ? new Date(params.from) : undefined,
//         to: params.to ? new Date(params.to) : undefined,
//         match: params.match,
//       });
//       return [{ type: "text", text: `Found ${count} memories.` }];
//     },
//   );
// };
