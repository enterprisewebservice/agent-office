import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  PageSection,
  Spinner,
  TextArea,
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon, KeyIcon } from '@patternfly/react-icons';

import type { SmallModelRouter } from '../types';
import { checkHealth, fetchRouters, fetchClaudeStatus, updateClaudeCredentials } from '../api';
import type { ClaudeStatus } from '../api';

const SettingsPage: React.FC = () => {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [routers, setRouters] = useState<SmallModelRouter[]>([]);
  const [routersLoading, setRoutersLoading] = useState(true);
  const [routersError, setRoutersError] = useState<string | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [claudeCredInput, setClaudeCredInput] = useState('');
  const [claudeSaving, setClaudeSaving] = useState(false);
  const [claudeMessage, setClaudeMessage] = useState<{ type: 'success' | 'danger'; text: string } | null>(null);

  const loadClaudeStatus = () => {
    fetchClaudeStatus()
      .then(setClaudeStatus)
      .catch(() => setClaudeStatus({ connected: false, hasRefreshToken: false, secretExists: false }));
  };

  const handleSaveCredentials = async () => {
    setClaudeSaving(true);
    setClaudeMessage(null);
    try {
      const parsed = JSON.parse(claudeCredInput);
      const result = await updateClaudeCredentials(parsed);
      setClaudeMessage({ type: 'success', text: result.message || 'Credentials saved successfully.' });
      setClaudeCredInput('');
      loadClaudeStatus();
    } catch (err) {
      setClaudeMessage({
        type: 'danger',
        text: err instanceof Error ? err.message : 'Failed to save credentials',
      });
    } finally {
      setClaudeSaving(false);
    }
  };

  useEffect(() => {
    checkHealth().then(setHealthy);
    loadClaudeStatus();

    setRoutersLoading(true);
    fetchRouters()
      .then((data) => {
        setRouters(data);
        setRoutersError(null);
      })
      .catch((err) => {
        setRoutersError(err instanceof Error ? err.message : 'Failed to fetch routers');
      })
      .finally(() => setRoutersLoading(false));
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          Settings
        </Title>
      </PageSection>
      <PageSection>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '800px' }}>
          {/* Cluster Connection */}
          <Card>
            <CardTitle>Cluster Connection</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>
                    {healthy === null ? (
                      <Spinner size="md" />
                    ) : healthy ? (
                      <Label color="green" icon={<CheckCircleIcon />}>
                        Connected
                      </Label>
                    ) : (
                      <Label color="red" icon={<ExclamationCircleIcon />}>
                        Disconnected
                      </Label>
                    )}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Backend API</DescriptionListTerm>
                  <DescriptionListDescription>
                    {window.location.origin}/api
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>

          {/* Claude Subscription */}
          <Card>
            <CardTitle>Claude Subscription</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>
                    {claudeStatus === null ? (
                      <Spinner size="md" />
                    ) : claudeStatus.connected ? (
                      <Label color="green" icon={<CheckCircleIcon />}>
                        Connected {claudeStatus.accountId ? `(${claudeStatus.accountId})` : ''}
                      </Label>
                    ) : (
                      <Label color="red" icon={<ExclamationCircleIcon />}>
                        Not Connected
                      </Label>
                    )}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>

              <div style={{ marginTop: '1rem' }}>
                <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                  To connect your Claude Max subscription, run <code>claude auth login</code> on your
                  local machine, then paste the contents of <code>~/.codex/auth.json</code> below.
                  All agents will use this shared subscription.
                </p>
                <TextArea
                  aria-label="Claude credentials JSON"
                  placeholder='Paste contents of ~/.codex/auth.json here...'
                  value={claudeCredInput}
                  onChange={(_e, val) => setClaudeCredInput(val)}
                  rows={4}
                  style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
                <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <Button
                    variant="primary"
                    icon={<KeyIcon />}
                    onClick={handleSaveCredentials}
                    isDisabled={!claudeCredInput.trim() || claudeSaving}
                    isLoading={claudeSaving}
                  >
                    Save Credentials
                  </Button>
                </div>
                {claudeMessage && (
                  <Alert
                    variant={claudeMessage.type}
                    title={claudeMessage.text}
                    isInline
                    isPlain
                    style={{ marginTop: '0.5rem' }}
                  />
                )}
              </div>
            </CardBody>
          </Card>

          {/* SmallModelRouters */}
          <Card>
            <CardTitle>Detected SmallModelRouters</CardTitle>
            <CardBody>
              {routersLoading && <Spinner size="md" />}
              {routersError && (
                <Alert variant="warning" title="Could not load routers" isInline isPlain>
                  {routersError}
                </Alert>
              )}
              {!routersLoading && !routersError && routers.length === 0 && (
                <p style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                  No SmallModelRouters detected on the cluster.
                </p>
              )}
              {routers.map((router) => (
                <Card key={router.name} isPlain style={{ marginBottom: '0.75rem' }}>
                  <CardBody>
                    <DescriptionList isHorizontal>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Name</DescriptionListTerm>
                        <DescriptionListDescription>{router.name}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Namespace</DescriptionListTerm>
                        <DescriptionListDescription>{router.namespace}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Endpoint</DescriptionListTerm>
                        <DescriptionListDescription>{router.endpoint}</DescriptionListDescription>
                      </DescriptionListGroup>
                      <DescriptionListGroup>
                        <DescriptionListTerm>Phase</DescriptionListTerm>
                        <DescriptionListDescription>
                          <Label
                            color={router.phase === 'Running' ? 'green' : 'grey'}
                            isCompact
                          >
                            {router.phase}
                          </Label>
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    </DescriptionList>
                  </CardBody>
                </Card>
              ))}
            </CardBody>
          </Card>
        </div>
      </PageSection>
    </>
  );
};

export default SettingsPage;
