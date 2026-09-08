
import { formatCurrentTime } from "../../prompts/formatters.js";
import { CompleteContext } from "../../context.js";

export const initTimeTools = (ctx: CompleteContext) => {

  ctx.managers.tools.add<{}>(
    'time_get',
    'Get Current Date and Time',
    'Get the current date and time both in local and GMT format. Use this tool to ground truth the current time.',
    true,
    async ({}) => {
      return [{ type: 'text', text: formatCurrentTime(new Date()) }];
    },
  );

};
