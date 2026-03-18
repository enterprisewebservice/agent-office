import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  CardBody,
  Drawer,
  DrawerContent,
  DrawerContentBody,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateHeader,
  EmptyStateIcon,
  Gallery,
  GalleryItem,
  PageSection,
  Spinner,
  Title,
  Button,
} from '@patternfly/react-core';
import { PlusCircleIcon, CubesIcon } from '@patternfly/react-icons';

import type { Agent } from '../types';
import { fetchAgents } from '../api';
import AgentCard from '../components/AgentCard';
import ChatPanel from '../components/ChatPanel';

const OfficePage: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 10000);
    return () => clearInterval(interval);
  }, [loadAgents]);

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
            titleText="Unable to load agents"
            headingLevel="h2"
            icon={<EmptyStateIcon icon={CubesIcon} />}
          />
          <EmptyStateBody>{error}</EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={loadAgents}>
                Retry
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      </PageSection>
    );
  }

  const drawerContent = (
    <>
      <PageSection>
        <Title headingLevel="h1" size="2xl" style={{ marginBottom: '1.5rem' }}>
          The Office
        </Title>
      </PageSection>
      <PageSection>
        {agents.length === 0 ? (
          <EmptyState>
            <EmptyStateHeader
              titleText="No agents yet"
              headingLevel="h2"
              icon={<EmptyStateIcon icon={CubesIcon} />}
            />
            <EmptyStateBody>
              Create your first AI agent to get started. Agents can chat, use tools, and route
              through your Small Model Router.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" component={(props) => <Link {...props} to="/create" />}>
                  Create Agent
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: '300px' }}>
            {agents.map((agent) => (
              <GalleryItem key={agent.name}>
                <AgentCard
                  agent={agent}
                  onChat={(a) => setChatAgent(a)}
                  onDeleted={loadAgents}
                />
              </GalleryItem>
            ))}
            <GalleryItem>
              <Link to="/create" style={{ textDecoration: 'none' }}>
                <Card
                  isClickable
                  isSelectable
                  style={{
                    minHeight: '200px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <CardBody
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <PlusCircleIcon
                      style={{ color: 'var(--pf-t--global--color--brand--default)', width: '3rem', height: '3rem' }}
                    />
                    <span style={{ fontSize: '1rem', fontWeight: 600 }}>Create Agent</span>
                  </CardBody>
                </Card>
              </Link>
            </GalleryItem>
          </Gallery>
        )}
      </PageSection>
    </>
  );

  return (
    <Drawer isExpanded={chatAgent !== null} onExpand={() => {}}>
      <DrawerContent
        panelContent={
          chatAgent ? (
            <ChatPanel agent={chatAgent} onClose={() => setChatAgent(null)} />
          ) : undefined
        }
      >
        <DrawerContentBody>{drawerContent}</DrawerContentBody>
      </DrawerContent>
    </Drawer>
  );
};

export default OfficePage;
