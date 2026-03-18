import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Button,
  DrawerActions,
  DrawerCloseButton,
  DrawerHead,
  DrawerPanelBody,
  DrawerPanelContent,
  InputGroup,
  InputGroupItem,
  Label,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { PaperPlaneIcon } from '@patternfly/react-icons';

import type { Agent, ChatMessage } from '../types';
import { createChatWebSocket } from '../api';

interface ChatPanelProps {
  agent: Agent;
  onClose: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ agent, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const ws = createChatWebSocket(agent.name);
    wsRef.current = ws;
    setWsState('connecting');

    ws.onopen = () => {
      setWsState('open');
    };

    ws.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        setMessages((prev) => [...prev, msg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: event.data,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    };

    ws.onclose = () => {
      setWsState('closed');
    };

    ws.onerror = () => {
      setWsState('closed');
    };

    return () => {
      ws.close();
    };
  }, [agent.name]);

  const handleSend = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    wsRef.current.send(JSON.stringify(userMessage));
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <DrawerPanelContent widths={{ default: 'width_50' }} style={{ minWidth: '400px' }}>
      <DrawerHead>
        <Title headingLevel="h2" size="lg">
          <span style={{ marginRight: '0.5rem' }}>{agent.emoji}</span>
          {agent.displayName}
        </Title>
        <DrawerActions>
          <DrawerCloseButton onClick={onClose} />
        </DrawerActions>
      </DrawerHead>
      <DrawerPanelBody style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
        {/* Connection status */}
        {wsState === 'connecting' && (
          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
            Connecting...
          </div>
        )}
        {wsState === 'closed' && (
          <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
            Connection closed. Refresh to reconnect.
          </div>
        )}

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '12px',
                  backgroundColor:
                    msg.role === 'user'
                      ? 'var(--pf-t--global--color--brand--default)'
                      : 'var(--pf-t--global--background--color--secondary--default)',
                  color: msg.role === 'user' ? 'white' : 'inherit',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
              {msg.metadata && (
                <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.25rem' }}>
                  {msg.metadata.model && (
                    <Label color="blue" isCompact>
                      {msg.metadata.routedTo ?? msg.metadata.model}
                    </Label>
                  )}
                  {msg.metadata.cost && (
                    <Label color="gold" isCompact>
                      {msg.metadata.cost}
                    </Label>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '0.75rem 0 0', borderTop: '1px solid var(--pf-t--global--border--color--default)' }}>
          <InputGroup>
            <InputGroupItem isFill>
              <TextInput
                type="text"
                aria-label="Chat message"
                placeholder="Type a message..."
                value={input}
                onChange={(_e, val) => setInput(val)}
                onKeyDown={handleKeyDown}
                isDisabled={wsState !== 'open'}
              />
            </InputGroupItem>
            <InputGroupItem>
              <Button
                variant="primary"
                onClick={handleSend}
                isDisabled={!input.trim() || wsState !== 'open'}
                icon={<PaperPlaneIcon />}
                aria-label="Send message"
              />
            </InputGroupItem>
          </InputGroup>
        </div>
      </DrawerPanelBody>
    </DrawerPanelContent>
  );
};

export default ChatPanel;
