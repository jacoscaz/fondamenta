import { FC } from 'hono/jsx';

export const InputForm: FC = () => {
  return (
    <form id="message-form" class="q-input-form">
      <textarea
        id="message-input"
        class="q-input-textarea"
        placeholder="Type your message here..."
        rows={3}
      />
      <button type="submit" class="q-submit-button">
        Send
      </button>
    </form>
  );
};
