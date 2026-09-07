import { CompleteContext } from "../../context.js";

export const initProcessTools = (ctx: CompleteContext) => {

  ctx.managers.tools.add<{}>(
    'process_pid',
    'Get Process PID',
    'Get the process ID of the current process',
    true,
    async () => {
      return [{ type: 'text', text: `PID: ${process.pid}` }];
    });

  ctx.managers.tools.add<{ exit_code: number; }>(
    'process_exit',
    'Terminate the current process',
    'Terminate the current process with the provided exit code, useful for restarting. Use exit code 0 for regular restarts.',
    true,
    async (params) => {
      const code = params.exit_code ?? 0;
      setTimeout(() => process.exit(code), 5_000);
      return [{ type: 'text', text: `Process will be terminated in 5 seconds with exit code ${code}.` }];
  });

};
