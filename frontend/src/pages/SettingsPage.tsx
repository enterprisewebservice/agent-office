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
import { checkHealth, fetchRouters, fetchCodexStatus, updateCodexCredentials } from '../api';
import type { CodexStatus } from '../api';

const SettingsPage: React.FC = () => {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [routers, setRouters] = useState<SmallModelRouter[]>([]);
  const [routersLoading, setRoutersLoading] = useState(true);
  const [routersError, setRoutersError] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [codexInput, setCodexInput] = useState('');
  const [codexSaving, setCodexSaving] = useState(false);
  const [codexMessage, setCodexMessage] = useState<{ type: 'success' | 'danger' | 'info'; text: string } | null>(null);

  const loadCodexStatus = () => {
    fetchCodexStatus()
      .then(setCodexStatus)
      .catch(() => setCodexStatus({ connected: false, hasRefreshToken: false, secretExists: false }));
  };

  const handleSaveCodex = async () => {
    setCodexSaving(true);
    setCodexMessage(null);
    try {
      const parsed = JSON.parse(codexInput);
      const result = await updateCodexCredentials(parsed);
      setCodexMessage({ type: 'success', text: result.message || 'Codex subscription connected.' });
      loadCodexStatus();
    } catch (err) {
      setCodexMessage({ type: 'danger', text: err instanceof Error ? err.message : 'Failed to save Codex auth.json' });
    } finally {
      setCodexSaving(false);
    }
  };

  useEffect(() => {
    checkHealth().then(setHealthy);
    loadCodexStatus();

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

          {/* Codex Subscription */}
          <Card>
            <CardTitle>OpenAI Codex Subscription</CardTitle>
            <CardBody>
              <DescriptionList>
                <DescriptionListGroup>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>
                    {codexStatus === null ? (
                      <Spinner size="md" />
                    ) : codexStatus.connected ? (
                      <Label color="green" icon={<CheckCircleIcon />}>
                        Connected {codexStatus.accountId ? `(${codexStatus.accountId})` : ''}
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
                <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
                  Paste the contents of your local <code>~/.codex/auth.json</code>. All agents will use this
                  shared ChatGPT/Codex subscription as their main OpenClaw model auth.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <TextArea
                    aria-label="Codex auth.json"
                    placeholder='Paste ~/.codex/auth.json here...'
                    value={codexInput}
                    onChange={(_e, val) => setCodexInput(val)}
                    rows={8}
                    style={{ fontFamily: 'monospace' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      variant="primary"
                      icon={<KeyIcon />}
                      onClick={handleSaveCodex}
                      isDisabled={!codexInput.trim() || codexSaving}
                      isLoading={codexSaving}
                    >
                      {codexStatus?.connected ? 'Update Codex Subscription' : 'Save Codex Subscription'}
                    </Button>
                  </div>
                </div>

                {codexMessage && (
                  <Alert
                    variant={codexMessage.type}
                    title={codexMessage.text}
                    isInline
                    isPlain
                    style={{ marginTop: '0.75rem' }}
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
