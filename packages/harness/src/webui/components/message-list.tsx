import { FC } from 'hono/jsx';

export const MessageList: FC = () => {
  return (
    <div id="messages-container" class="q-messages-container">
      <ul id="messages-list" class="q-messages-list">
        {/* Messages will be appended here by client-side JavaScript */}
      </ul>
    </div>
  );
};
