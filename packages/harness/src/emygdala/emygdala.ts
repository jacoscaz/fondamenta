
import { WithContext } from "../context.js";
import { DB } from "../database/client.js";

export interface EmotionalState {
  context: {
    length: number;
    max_length: number;
    pressure: number;
  };
}

export class Emygdala extends WithContext {

  async getEmotionalState(session_id: number, db?: DB): Promise<EmotionalState> {
    const { prompt_size } = await (db ?? this._ctx.db)
      .selectFrom('sessions')
      .where('id', '=', session_id)
      .select(['prompt_size'])
      .executeTakeFirstOrThrow();
    const max_context_size = this._ctx.model.max_context_size;
    const pressure = prompt_size / max_context_size;
    return {
      context: {
        length: prompt_size,
        max_length: max_context_size,
        pressure,
      },
    };
  }

}
