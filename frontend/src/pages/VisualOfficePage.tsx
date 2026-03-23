import React, { useCallback, useEffect, useMemo, useState, startTransition } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateHeader,
  EmptyStateIcon,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import { CubesIcon, PlusCircleIcon } from '@patternfly/react-icons';

import type { Agent } from '../types';
import { fetchAgents } from '../api';
import ChatPanel from '../components/ChatPanel';
import './visual-office.css';

const employeeColors = [
  { shirt: '#2563eb', chair: '#fb923c', hair: '#5b371d' },
  { shirt: '#0f766e', chair: '#ef4444', hair: '#2e2017' },
  { shirt: '#7c3aed', chair: '#f59e0b', hair: '#6b3f2d' },
  { shirt: '#dc2626', chair: '#2563eb', hair: '#432818' },
  { shirt: '#0891b2', chair: '#9333ea', hair: '#24160f' },
  { shirt: '#65a30d', chair: '#ea580c', hair: '#694b2f' },
];

const providerLabel = (provider: string): string => {
  switch (provider) {
    case 'smr':
      return 'Router';
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'custom':
      return 'Custom';
    default:
      return provider || 'Unknown';
  }
};

const statusTone = (phase: string | undefined): string => {
  switch (phase?.toLowerCase()) {
    case 'running':
      return 'is-running';
    case 'error':
    case 'failed':
      return 'is-down';
    default:
      return 'is-waiting';
  }
};

const agentSubtitle = (agent: Agent): string => {
  const description = agent.description?.trim();
  if (!description) {
    return 'Available for office walk-up conversation.';
  }
  return description.length > 76 ? `${description.slice(0, 73)}...` : description;
};

const sceneMetrics = (index: number) => {
  const row = Math.floor(index / 3);
  return {
    animationDelay: `${(index % 6) * 180}ms`,
    zIndex: 30 - row,
  };
};

const VisualOfficePage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const data = await fetchAgents();
      startTransition(() => {
        setAgents(data);
        setError(null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    const interval = window.setInterval(() => {
      void loadAgents();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [loadAgents]);

  const runningCount = useMemo(
    () => agents.filter((agent) => agent.status?.phase?.toLowerCase() === 'running').length,
    [agents],
  );

  if (loading) {
    return (
      <PageSection>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <Spinner size="xl" />
        </div>
      </PageSection>
    );
  }

  if (error && agents.length === 0) {
    return (
      <PageSection>
        <EmptyState>
          <EmptyStateHeader
            titleText="Unable to load the visual office"
            headingLevel="h2"
            icon={<EmptyStateIcon icon={CubesIcon} />}
          />
          <EmptyStateBody>{error}</EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={() => void loadAgents()}>
                Retry
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </PageSection>
    );
  }

  const drawerBody = (
    <div className="visualOffice">
      <div className="visualOffice__shell">
        <section className="visualOffice__hero">
          <div className="visualOffice__titleCard">
            <span className="visualOffice__eyebrow">Visual Office</span>
            <h1>Walk the floor. Visit an agent. Sit down and talk.</h1>
            <p>
              This is the separate visual office app layered on top of the existing Agent Office.
              Each employee gets a visible workstation, a Mac at their desk, and a live seat you can
              walk up to when you want to chat.
            </p>
            <div className="visualOffice__heroActions">
              <Button component={(props) => <Link {...props} to="/create" />} variant="primary">
                Hire New Agent
              </Button>
              <Button component={(props) => <Link {...props} to="/" />} variant="secondary">
                Open Classic Office
              </Button>
              <div className="visualOffice__meta">
                <span className="visualOffice__pill">{agents.length} desks occupied</span>
                <span className="visualOffice__pill">{runningCount} agents running</span>
                <span className="visualOffice__pill">Auto-refresh every 10s</span>
              </div>
            </div>
          </div>

          <aside className="visualOffice__roster">
            <h2 className="visualOffice__rosterTitle">Employees On Shift</h2>
            <div className="visualOffice__rosterList">
              {agents.map((agent) => (
                <button
                  key={agent.name}
                  className={`visualOffice__rosterItem ${chatAgent?.name === agent.name ? 'is-selected' : ''}`}
                  onClick={() => setChatAgent(agent)}
                  type="button"
                >
                  <div className="visualOffice__avatar">{agent.emoji || '\u{1F464}'}</div>
                  <div>
                    <div className="visualOffice__rosterName">{agent.displayName || agent.name}</div>
                    <div className="visualOffice__rosterDesc">
                      {providerLabel(agent.provider)} · {agent.modelName || 'auto'}
                    </div>
                  </div>
                  <span className={`visualOffice__badge ${statusTone(agent.status?.phase)}`}>
                    {agent.status?.phase || 'Waiting'}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </section>

        <section className="visualOffice__officeViewport">
          <div className="visualOffice__officeScene">
            <div className="visualOffice__scanline" />
            <div className="visualOffice__windows">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="visualOffice__window" key={index} />
              ))}
            </div>
            <div className="visualOffice__plants">
              <div className="visualOffice__plant" />
              <div className="visualOffice__plant" />
            </div>
            <div className="visualOffice__floor" />

            {agents.length === 0 ? (
              <div className="visualOffice__emptyDesk">
                <div>
                  <PlusCircleIcon style={{ width: '3rem', height: '3rem', marginBottom: '0.6rem' }} />
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>No employees on the floor yet</div>
                  <div className="visualOffice__deskHint">
                    Create an agent and their workstation will appear here automatically.
                  </div>
                  <div style={{ marginTop: '1rem' }}>
                    <Button component={(props) => <Link {...props} to="/create" />} variant="primary">
                      Create Agent
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="visualOffice__desks">
                {agents.map((agent, index) => {
                  const palette = employeeColors[index % employeeColors.length];
                  const metrics = sceneMetrics(index);

                  return (
                    <button
                      key={agent.name}
                      type="button"
                      className={`visualOffice__desk ${chatAgent?.name === agent.name ? 'is-selected' : ''}`}
                      onClick={() => setChatAgent(agent)}
                      style={{ zIndex: metrics.zIndex }}
                    >
                      <div className="visualOffice__deskShadow" />
                      <div className="visualOffice__deskIso">
                        <div className="visualOffice__deskTop" />
                        <div className="visualOffice__deskSide" />
                        <div className="visualOffice__computer" />
                        <div className="visualOffice__monitor" />
                        <div
                          className={`visualOffice__person ${chatAgent?.name === agent.name ? 'is-engaged' : ''}`}
                        >
                          <div
                            className="visualOffice__personBob"
                            style={{ animationDelay: metrics.animationDelay }}
                          >
                            <div
                              className="visualOffice__personHair"
                              style={{ ['--hair-color' as string]: palette.hair }}
                            />
                            <div className="visualOffice__personHead" />
                            <div
                              className="visualOffice__personBody"
                              style={{ ['--shirt-color' as string]: palette.shirt }}
                            />
                            <div
                              className="visualOffice__personChair"
                              style={{ ['--chair-color' as string]: palette.chair }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="visualOffice__deskInfo">
                        <div className="visualOffice__deskNameRow">
                          <h3 className="visualOffice__deskName">
                            <span style={{ marginRight: '0.4rem' }}>{agent.emoji || '\u{1F464}'}</span>
                            {agent.displayName || agent.name}
                          </h3>
                          <span className={`visualOffice__badge ${statusTone(agent.status?.phase)}`}>
                            {agent.status?.phase || 'Waiting'}
                          </span>
                        </div>
                        <p className="visualOffice__deskSubtitle">{agentSubtitle(agent)}</p>
                        <div className="visualOffice__deskMeta">
                          <span className="visualOffice__badge">{providerLabel(agent.provider)}</span>
                          <span className="visualOffice__badge">{agent.modelName || 'auto'}</span>
                          <span className="visualOffice__badge">{agent.tools?.length || 0} tools</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );

  return (
    <Drawer isExpanded={chatAgent !== null} onExpand={() => {}}>
      <DrawerContent
        panelContent={
          chatAgent ? <ChatPanel key={chatAgent.name} agent={chatAgent} onClose={() => setChatAgent(null)} /> : undefined
        }
      >
        <DrawerContentBody>{drawerBody}</DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
};

export default VisualOfficePage;
