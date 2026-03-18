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
  Tooltip,
} from '@patternfly/react-core';
import { MicrophoneIcon, PaperPlaneIcon, VolumeUpIcon } from '@patternfly/react-icons';

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
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');

        if (event.results[0].isFinal) {
          // Final result — send the message
          setInput('');
          setIsListening(false);
          if (transcript.trim() && wsRef.current?.readyState === WebSocket.OPEN) {
            const userMessage: ChatMessage = {
              role: 'user',
              content: transcript.trim(),
              timestamp: new Date().toISOString(),
            };
            wsRef.current.send(JSON.stringify(userMessage));
            setMessages((prev) => [...prev, userMessage]);
          }
        } else {
          // Interim result — show in input box
          setInput(transcript);
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Speak assistant messages aloud
  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to pick a good voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.name.includes('Samantha') || v.name.includes('Google') || v.name.includes('Daniel')
    );
    if (preferred) utterance.voice = preferred;

    window.speechSynthesis.speak(utterance);
  }, [ttsEnabled]);

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
        // Speak assistant responses
        if (msg.role === 'assistant' && msg.content) {
          speak(msg.content);
        }
      } catch {
        const content = event.data;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content,
            timestamp: new Date().toISOString(),
          },
        ]);
        speak(content);
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
      window.speechSynthesis?.cancel();
    };
  }, [agent.name, speak]);

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

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setInput('');
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const hasSpeechRecognition =
    typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  return (
    <DrawerPanelContent widths={{ default: 'width_50' }} style={{ minWidth: '400px' }}>
      <DrawerHead>
        <Title headingLevel="h2" size="lg">
          <span style={{ marginRight: '0.5rem' }}>{agent.emoji}</span>
          {agent.displayName}
        </Title>
        <DrawerActions>
          <Tooltip content={ttsEnabled ? 'Mute voice' : 'Enable voice'}>
            <Button
              variant={ttsEnabled ? 'plain' : 'plain'}
              onClick={() => {
                setTtsEnabled(!ttsEnabled);
                if (ttsEnabled) window.speechSynthesis?.cancel();
              }}
              style={{ opacity: ttsEnabled ? 1 : 0.4 }}
              aria-label="Toggle text-to-speech"
            >
              <VolumeUpIcon />
            </Button>
          </Tooltip>
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

        {/* Input with voice */}
        <div style={{ padding: '0.75rem 0 0', borderTop: '1px solid var(--pf-t--global--border--color--default)' }}>
          <InputGroup>
            {hasSpeechRecognition && (
              <InputGroupItem>
                <Tooltip content={isListening ? 'Stop listening' : 'Speak'}>
                  <Button
                    variant={isListening ? 'danger' : 'control'}
                    onClick={toggleListening}
                    isDisabled={wsState !== 'open'}
                    icon={<MicrophoneIcon />}
                    aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                    style={isListening ? { animation: 'pulse 1.5s infinite' } : {}}
                  />
                </Tooltip>
              </InputGroupItem>
            )}
            <InputGroupItem isFill>
              <TextInput
                type="text"
                aria-label="Chat message"
                placeholder={isListening ? 'Listening...' : 'Type a message...'}
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

        {/* Pulse animation for microphone */}
        <style>{`
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(201, 25, 11, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(201, 25, 11, 0); }
            100% { box-shadow: 0 0 0 0 rgba(201, 25, 11, 0); }
          }
        `}</style>
      </DrawerPanelBody>
    </DrawerPanelContent>
  );
};

export default ChatPanel;
