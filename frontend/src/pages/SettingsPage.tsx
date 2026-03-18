import React, { useEffect, useState } from 'react';
import {
  Alert,
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
  Title,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';

import type { SmallModelRouter } from '../types';
import { checkHealth, fetchRouters } from '../api';

const SettingsPage: React.FC = () => {
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [routers, setRouters] = useState<SmallModelRouter[]>([]);
  const [routersLoading, setRoutersLoading] = useState(true);
  const [routersError, setRoutersError] = useState<string | null>(null);

  useEffect(() => {
    checkHealth().then(setHealthy);

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
