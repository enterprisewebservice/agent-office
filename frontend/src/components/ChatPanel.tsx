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
  Spinner,
  TextInput,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { MicrophoneIcon, PaperPlaneIcon, VolumeUpIcon } from '@patternfly/react-icons';

import type { Agent, AgentSessionState, ChatMessage } from '../types';
import { createChatWebSocket, fetchAgentSessionState, resetAgentSessions, startFreshAgentSession, synthesizeSpeech } from '../api';

interface ChatPanelProps {
  agent: Agent;
  onClose: () => void;
}

function getChatStorageKey(agentName: string): string {
  return `agent-office-chat:${agentName}`;
}

function loadStoredMessages(agentName: string): ChatMessage[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.sessionStorage.getItem(getChatStorageKey(agentName));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ChatMessage => (
      entry &&
      typeof entry === 'object' &&
      typeof entry.role === 'string' &&
      typeof entry.content === 'string' &&
      typeof entry.timestamp === 'string'
    ));
  } catch {
    return [];
  }
}

function parseToolCalls(message: ChatMessage): string[] {
  if (!message.metadata?.tools) return [];
  return message.metadata.tools
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function isSkillCall(toolName: string): boolean {
  return toolName.startsWith('claude_code_');
}

function formatActivityLabel(toolName: string): string {
  if (isSkillCall(toolName)) {
    if (toolName === 'claude_code_resume') {
      return 'Skill: Claude Code subscription (resume)';
    }
    if (toolName === 'claude_code_sessions') {
      return 'Skill: Claude Code subscription (sessions)';
    }
    return `Skill: Claude Code subscription (${toolName})`;
  }
  return `Tool: ${toolName}`;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

const ChatPanel: React.FC<ChatPanelProps> = ({ agent, onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages(agent.name));
  const [input, setInput] = useState('');
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [isListening, setIsListening] = useState(false);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [hasQueuedOpenAIAudio, setHasQueuedOpenAIAudio] = useState(false);
  const [sessionState, setSessionState] = useState<AgentSessionState | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [isSessionActionRunning, setIsSessionActionRunning] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.sessionStorage.setItem(getChatStorageKey(agent.name), JSON.stringify(messages));
    } catch (err) {
      console.warn('Failed to persist chat messages for agent.', err);
    }
  }, [agent.name, messages]);

  const clearAudioState = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setHasQueuedOpenAIAudio(false);
  }, []);

  const unlockQueuedAudio = useCallback(async () => {
    if (!audioRef.current) return;

    try {
      await audioRef.current.play();
      setHasQueuedOpenAIAudio(false);
      setVoiceNotice(null);
    } catch {
      setVoiceNotice('OpenAI voice is ready, but your browser is still blocking playback. Press play again.');
    }
  }, []);

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
            setIsAgentThinking(true);
            setPendingUserMessage(userMessage.content);
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

  // Speak assistant messages aloud using OpenAI TTS first, browser voices only as fallback.
  const speak = useCallback(async (text: string) => {
    if (!ttsEnabled) return;

    clearAudioState();
    window.speechSynthesis?.cancel();
    setVoiceNotice(null);

    let blob: Blob;
    try {
      blob = await synthesizeSpeech(text);
    } catch (err) {
      console.warn('OpenAI TTS failed, falling back to browser speech synthesis.', err);
      if (!window.speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.name.includes('Samantha') || v.name.includes('Google') || v.name.includes('Daniel')
      );
      if (preferred) {
        utterance.voice = preferred;
      }

      setVoiceNotice('OpenAI voice generation failed, so the browser voice was used for this reply.');
      window.speechSynthesis.speak(utterance);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    audioUrlRef.current = objectUrl;
    const audio = new Audio(objectUrl);
    audioRef.current = audio;
    audio.onended = () => {
      clearAudioState();
      setVoiceNotice(null);
    };

    try {
      await audio.play();
      setHasQueuedOpenAIAudio(false);
      return;
    } catch (err) {
      console.warn('OpenAI TTS playback was blocked by the browser.', err);
      setHasQueuedOpenAIAudio(true);
      setVoiceNotice('OpenAI voice is ready. Press play to hear it.');
    }
  }, [clearAudioState, ttsEnabled]);

  const refreshSessionState = useCallback(async () => {
    try {
      const state = await fetchAgentSessionState(agent.name);
      setSessionState(state);
    } catch (err) {
      console.warn('Failed to fetch agent session state.', err);
    }
  }, [agent.name]);

  useEffect(() => {
    setMessages(loadStoredMessages(agent.name));
    setInput('');
    setIsListening(false);
    setIsAgentThinking(false);
    setPendingUserMessage(null);
    setVoiceNotice(null);
    setSessionNotice(null);
    clearAudioState();
    window.speechSynthesis?.cancel();
  }, [agent.name, clearAudioState]);

  useEffect(() => {
    void refreshSessionState();

    const ws = createChatWebSocket(agent.name);
    wsRef.current = ws;
    setWsState('connecting');

    ws.onopen = () => {
      setWsState('open');
    };

    ws.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        if (msg.role === 'assistant') {
          setIsAgentThinking(false);
          setPendingUserMessage(null);
        }

        const trimmedContent = msg.content?.trim() ?? '';
        const hasVisibleContent = trimmedContent.length > 0;
        const hasMetadata = !!msg.metadata && Object.keys(msg.metadata).length > 0;

        if (msg.role === 'assistant' && !hasVisibleContent && !hasMetadata) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'system',
              content: `${agent.displayName || agent.name} returned no text for that turn. Please retry.`,
              timestamp: new Date().toISOString(),
            },
          ]);
          return;
        }

        setMessages((prev) => [...prev, msg]);
        if (msg.role === 'assistant' && hasVisibleContent) {
          void speak(msg.content);
        }
        void refreshSessionState();
      } catch {
        const content = event.data;
        setIsAgentThinking(false);
        setPendingUserMessage(null);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content,
            timestamp: new Date().toISOString(),
          },
        ]);
        void speak(content);
        void refreshSessionState();
      }
    };

    ws.onclose = () => {
      setWsState('closed');
      setIsAgentThinking(false);
      setPendingUserMessage(null);
    };

    ws.onerror = () => {
      setWsState('closed');
      setIsAgentThinking(false);
      setPendingUserMessage(null);
    };

    return () => {
      ws.close();
      clearAudioState();
      window.speechSynthesis?.cancel();
    };
  }, [agent.name, clearAudioState, connectionEpoch, refreshSessionState, speak]);

  const runSessionAction = useCallback(async (mode: 'fresh' | 'reset') => {
    setIsSessionActionRunning(true);
    setSessionNotice(null);

    try {
      const result = mode === 'fresh'
        ? await startFreshAgentSession(agent.name)
        : await resetAgentSessions(agent.name);

      setSessionState(result.state);
      setSessionNotice(result.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: result.message,
          timestamp: new Date().toISOString(),
        },
      ]);

      wsRef.current?.close();
      setConnectionEpoch((value) => value + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to ${mode === 'fresh' ? 'start a fresh session' : 'reset sessions'}.`;
      setSessionNotice(message);
    } finally {
      setIsSessionActionRunning(false);
    }
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
    setIsAgentThinking(true);
    setPendingUserMessage(userMessage.content);
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
    <DrawerPanelContent
      widths={{ default: 'width_33' }}
      style={{
        width: 'min(26rem, calc(100vw - 1rem))',
        minWidth: 'min(22rem, calc(100vw - 1rem))',
        maxWidth: 'calc(100vw - 1rem)',
        height: 'min(820px, calc(100vh - 1rem))',
        maxHeight: 'calc(100vh - 1rem)',
        margin: '0.5rem 0.5rem 0.5rem 0',
        position: 'sticky',
        top: '0.5rem',
        alignSelf: 'flex-start',
        borderRadius: '22px',
        overflow: 'hidden',
        boxShadow: '0 24px 48px rgba(20, 33, 61, 0.18)',
        border: '1px solid rgba(20, 33, 61, 0.12)',
        background: '#fff8ea',
        opacity: 1,
      }}
    >
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
                if (ttsEnabled) {
                  clearAudioState();
                  setVoiceNotice(null);
                  window.speechSynthesis?.cancel();
                }
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
      <DrawerPanelBody style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 84px)', overflow: 'hidden' }}>
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
        {(sessionState || sessionNotice) && (
          <div
            style={{
              margin: '0 1rem',
              padding: '0.9rem 1rem',
              borderRadius: '12px',
              border: '1px solid var(--pf-t--global--border--color--default)',
              background: 'rgba(20, 33, 61, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--pf-t--global--text--color--subtle)' }}>
                Session State
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => void runSessionAction('fresh')} isDisabled={isSessionActionRunning}>
                  Fresh Session
                </Button>
                <Button variant="warning" size="sm" onClick={() => void runSessionAction('reset')} isDisabled={isSessionActionRunning}>
                  Reset Agent Memory
                </Button>
              </div>
            </div>
            {sessionState && (
              <>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <Label color={sessionState.cachedConnection ? 'green' : 'grey'} isCompact>
                    Gateway {sessionState.cachedConnection ? 'connected' : 'not cached'}
                  </Label>
                  <Label color="blue" isCompact>
                    OpenClaw chats: {sessionState.openclawSessionCount}
                  </Label>
                  <Label color="purple" isCompact>
                    Claude sessions: {sessionState.claudeActiveSessionCount} active / {sessionState.claudeHistoricalSessionCount} historical
                  </Label>
                </div>
                {(sessionState.claudeActiveTaskLabels?.length || sessionState.claudeRecentTaskLabels?.length) && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--pf-t--global--text--color--regular)' }}>
                    {sessionState.claudeActiveTaskLabels?.length ? (
                      <>Active Claude tasks: {sessionState.claudeActiveTaskLabels.join(', ')}</>
                    ) : (
                      <>Recent Claude tasks: {sessionState.claudeRecentTaskLabels?.join(', ')}</>
                    )}
                  </div>
                )}
                {sessionState.lastUserMessage && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--pf-t--global--text--color--regular)' }}>
                    Last user turn: {sessionState.lastUserMessage}
                  </div>
                )}
                {sessionState.lastAssistantMessage && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--pf-t--global--text--color--regular)' }}>
                    Last agent turn: {sessionState.lastAssistantMessage}
                  </div>
                )}
              </>
            )}
            {sessionNotice && (
              <div style={{ fontSize: '0.82rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                {sessionNotice}
              </div>
            )}
          </div>
        )}
        {(voiceNotice || hasQueuedOpenAIAudio) && (
          <div
            style={{
              margin: '0 1rem',
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              background: 'var(--pf-t--global--background--color--secondary--default)',
              border: '1px solid var(--pf-t--global--border--color--default)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <div style={{ fontSize: '0.9rem' }}>
              {voiceNotice ?? 'OpenAI voice is ready.'}
            </div>
            {hasQueuedOpenAIAudio && (
              <Button variant="secondary" icon={<VolumeUpIcon />} onClick={() => void unlockQueuedAudio()}>
                Play OpenAI Voice
              </Button>
            )}
          </div>
        )}
        {isAgentThinking && (
          <div
            style={{
              margin: '0 1rem',
              padding: '0.75rem 1rem',
              borderRadius: '12px',
              background: 'var(--pf-t--global--background--color--primary--default)',
              border: '1px dashed var(--pf-t--global--border--color--default)',
              color: 'var(--pf-t--global--text--color--subtle)',
              fontSize: '0.9rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: pendingUserMessage ? '0.45rem' : 0 }}>
              <Spinner size="md" />
              <span>{agent.displayName || agent.name} is thinking...</span>
            </div>
            {pendingUserMessage && (
              <div
                style={{
                  padding: '0.6rem 0.75rem',
                  borderRadius: '10px',
                  background: 'rgba(20, 33, 61, 0.04)',
                  color: 'var(--pf-t--global--text--color--regular)',
                  fontStyle: 'italic',
                }}
              >
                Waiting on a reply to: {pendingUserMessage}
              </div>
            )}
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
            (() => {
              const toolCalls = parseToolCalls(msg);
              const assistantActivity = msg.role === 'assistant';

              return (
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
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      marginBottom: '0.25rem',
                      color: 'var(--pf-t--global--text--color--subtle)',
                    }}
                  >
                    {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? (agent.displayName || agent.name) : 'Status'}
                    {msg.timestamp && (
                      <span style={{ marginLeft: '0.5rem', fontWeight: 400, textTransform: 'none' }}>
                        {formatTime(msg.timestamp)}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '12px',
                      backgroundColor:
                        msg.role === 'user'
                          ? '#1f5fbf'
                          : msg.role === 'system'
                            ? 'var(--pf-t--global--background--color--secondary--default)'
                          : 'var(--pf-t--global--background--color--secondary--default)',
                      color: msg.role === 'user' ? '#ffffff' : 'inherit',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      fontStyle: msg.role === 'system' ? 'italic' : 'normal',
                      border: msg.role === 'user' ? '1px solid rgba(8, 28, 74, 0.18)' : undefined,
                      boxShadow: msg.role === 'user' ? '0 8px 18px rgba(31, 95, 191, 0.18)' : undefined,
                    }}
                  >
                    {msg.content}
                  </div>

                  {(assistantActivity || msg.metadata) && (
                    <div
                      style={{
                        marginTop: '0.35rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '10px',
                        border: '1px solid var(--pf-t--global--border--color--default)',
                        background: 'var(--pf-t--global--background--color--primary--default)',
                        minWidth: '240px',
                      }}
                    >
                      {assistantActivity && (
                        <div
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            color: 'var(--pf-t--global--text--color--subtle)',
                            marginBottom: '0.35rem',
                          }}
                        >
                          Activity
                        </div>
                      )}

                      {assistantActivity && toolCalls.length === 0 && (
                        <div
                          style={{
                            fontSize: '0.85rem',
                            color: 'var(--pf-t--global--text--color--subtle)',
                          }}
                        >
                          No tool or skill calls reported for this turn.
                        </div>
                      )}

                      {toolCalls.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {toolCalls.map((tool, i) => (
                            <Label key={i} color={isSkillCall(tool) ? 'purple' : 'blue'} isCompact>
                              {formatActivityLabel(tool)}
                            </Label>
                          ))}
                        </div>
                      )}

                      {(msg.metadata?.model || msg.metadata?.cost) && (
                        <div style={{ marginTop: toolCalls.length > 0 || assistantActivity ? '0.5rem' : 0, display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {msg.metadata?.model && (
                            <Label color="blue" isCompact>
                              {msg.metadata.routedTo ?? msg.metadata.model}
                            </Label>
                          )}
                          {msg.metadata?.cost && (
                            <Label color="gold" isCompact>
                              {msg.metadata.cost}
                            </Label>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
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
