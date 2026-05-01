import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  EmptyStateHeader,
  EmptyStateIcon,
  ExpandableSection,
  Flex,
  FlexItem,
  Gallery,
  GalleryItem,
  Label,
  LabelGroup,
  PageSection,
  Spinner,
  Stack,
  StackItem,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import {
  CodeBranchIcon,
  CubesIcon,
  EditIcon,
  ExternalLinkAltIcon,
  MapIcon,
} from '@patternfly/react-icons';

import type { GovernanceAgent } from '../types';
import { fetchGovernanceAgents } from '../api';

const phaseLabelColor = (phase: string): 'green' | 'gold' | 'orange' | 'grey' => {
  switch (phase) {
    case 'Running':
      return 'green';
    case 'Provisioning':
      return 'gold';
    case 'Waiting':
      return 'orange';
    default:
      return 'grey';
  }
};

const truncate = (s: string | undefined, n: number): string => {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
};

/**
 * Splits a pulled image string of the form
 *   `quay-host/path/repo@sha256:abcd…`
 * into a short repo label and a short digest. Falls back to the declared
 * image when no digest is present.
 */
const formatImage = (declared?: string, pulled?: string): { repo: string; digest: string } => {
  const candidate = pulled || declared || '';
  if (!candidate) return { repo: '', digest: '' };
  const [repoPart, digestPart] = candidate.split('@');
  const segments = repoPart.split('/');
  const repo = segments[segments.length - 1] || repoPart;
  const digest = digestPart ? digestPart.replace(/^sha256:/, '') : '';
  return { repo, digest };
};

const AgentMapCard: React.FC<{ agent: GovernanceAgent }> = ({ agent }) => {
  const { repo, digest } = formatImage(agent.image, agent.imageId);
  const fullImage = agent.imageId || agent.image || '';
  const phase = agent.phase || 'Unknown';

  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>
        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <span style={{ fontSize: '1.5rem' }}>{agent.emoji || '🤖'}</span>
          </FlexItem>
          <FlexItem flex={{ default: 'flex_1' }}>
            <Title headingLevel="h3" size="lg">
              {agent.displayName || agent.name}
            </Title>
            <span
              style={{
                color: 'var(--pf-t--global--text--color--subtle)',
                fontSize: '0.85rem',
              }}
            >
              {agent.name}
            </span>
          </FlexItem>
          <FlexItem>
            <Label color={phaseLabelColor(phase)}>{phase}</Label>
          </FlexItem>
        </Flex>
      </CardTitle>

      <CardBody>
        <Stack hasGutter>
          {agent.description && (
            <StackItem>
              <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                {agent.description}
              </span>
            </StackItem>
          )}

          <StackItem>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Model</strong>
            <LabelGroup>
              <Label color="blue">{agent.provider || 'unknown'}</Label>
              <Label color="cyan">{agent.modelName || 'auto'}</Label>
            </LabelGroup>
          </StackItem>

          <StackItem>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Image</strong>
            {repo ? (
              <Tooltip content={fullImage || repo}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {truncate(repo, 40)}
                  {digest && (
                    <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                      {' @ '}
                      {truncate(digest, 12)}
                    </span>
                  )}
                </span>
              </Tooltip>
            ) : (
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  color: 'var(--pf-t--global--text--color--subtle)',
                }}
              >
                (no deployment yet)
              </span>
            )}
          </StackItem>

          <StackItem>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Tools</strong>
            <LabelGroup numLabels={6}>
              {(agent.tools || []).map((tool) => (
                <Label key={tool} color="grey" variant="outline">
                  {tool}
                </Label>
              ))}
              {(agent.tools || []).length === 0 && (
                <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>(none)</span>
              )}
            </LabelGroup>
          </StackItem>

          {agent.podName && (
            <StackItem>
              <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Pod</strong>
              <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{agent.podName}</span>
            </StackItem>
          )}

          {agent.ownerRef && (
            <StackItem>
              <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Owner</strong>
              <Label color="purple" variant="outline">
                {agent.ownerRef}
              </Label>
            </StackItem>
          )}

          {agent.memoryFiles && agent.memoryFiles.length > 0 && (
            <StackItem>
              <ExpandableSection
                toggleText={`Memory files (${agent.memoryFiles.length}) — ${
                  agent.memoryFiles.filter((f) => f.sharedWith.length > 0).length
                } shared`}
                isIndented
              >
                <Stack hasGutter>
                  {agent.memoryFiles.map((file) => (
                    <StackItem key={file.name}>
                      <Flex
                        spaceItems={{ default: 'spaceItemsSm' }}
                        alignItems={{ default: 'alignItemsCenter' }}
                        flexWrap={{ default: 'wrap' }}
                      >
                        <FlexItem>
                          <Tooltip content={`sha256: ${file.sha256.slice(0, 32)}…`}>
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {file.name}
                            </span>
                          </Tooltip>
                        </FlexItem>
                        {file.sharedWith.length > 0 ? (
                          <FlexItem>
                            <LabelGroup numLabels={4} categoryName="shared with">
                              {file.sharedWith.map((other) => (
                                <Label key={other} color="purple" variant="outline">
                                  {other}
                                </Label>
                              ))}
                            </LabelGroup>
                          </FlexItem>
                        ) : (
                          <FlexItem>
                            <Label color="grey" variant="outline" isCompact>
                              unique
                            </Label>
                          </FlexItem>
                        )}
                      </Flex>
                    </StackItem>
                  ))}
                </Stack>
              </ExpandableSection>
            </StackItem>
          )}
        </Stack>
      </CardBody>

      <CardFooter>
        <Stack hasGutter>
          <StackItem>
            <Alert
              variant="info"
              isInline
              isPlain
              title="Update this agent in Dev Spaces"
            >
              Click <strong>Open in Dev Spaces</strong> → edit{' '}
              <code>base/agentworkstation.yaml</code> (model, tools, system prompt) or{' '}
              <code>base/configmap.yaml</code> (memory files) → commit. ArgoCD syncs the change
              into the cluster within seconds.
            </Alert>
          </StackItem>
          <StackItem>
            <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }}>
              {agent.devSpacesUrl ? (
                <FlexItem>
                  <Button
                    variant="primary"
                    component="a"
                    href={agent.devSpacesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<EditIcon />}
                  >
                    Open in Dev Spaces
                  </Button>
                </FlexItem>
              ) : (
                <FlexItem>
                  <Tooltip content="Backstage component for this agent has no link of type=devspaces yet. Re-scaffold or add a links: entry to its catalog-info.yaml.">
                    <Button variant="primary" icon={<EditIcon />} isAriaDisabled>
                      Open in Dev Spaces
                    </Button>
                  </Tooltip>
                </FlexItem>
              )}
              {agent.gitopsRepoUrl && (
                <FlexItem>
                  <Button
                    variant="link"
                    component="a"
                    href={agent.gitopsRepoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<CodeBranchIcon />}
                  >
                    GitOps repo
                  </Button>
                </FlexItem>
              )}
              {agent.backstageUrl && (
                <FlexItem>
                  <Button
                    variant="link"
                    component="a"
                    href={agent.backstageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<ExternalLinkAltIcon />}
                  >
                    Backstage
                  </Button>
                </FlexItem>
              )}
            </Flex>
          </StackItem>
        </Stack>
      </CardFooter>
    </Card>
  );
};

const MapPage: React.FC = () => {
  const [agents, setAgents] = useState<GovernanceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchGovernanceAgents();
      setAgents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          <Flex
            spaceItems={{ default: 'spaceItemsSm' }}
            alignItems={{ default: 'alignItemsCenter' }}
          >
            <FlexItem>
              <MapIcon />
            </FlexItem>
            <FlexItem>Governance Map</FlexItem>
          </Flex>
        </Title>
        <p
          style={{
            marginTop: '0.75rem',
            maxWidth: '70ch',
            color: 'var(--pf-t--global--text--color--subtle)',
          }}
        >
          One card per agent. To <strong>update an agent's model, container image, tools,
          system prompt, or memory files</strong>: click <strong>Open in Dev Spaces</strong> on
          its card → edit the YAML in the browser IDE → commit. ArgoCD reconciles the change
          into the cluster automatically. No local tooling required, no permission to manage —
          everything is GitOps.
        </p>
      </PageSection>

      <PageSection>
        {loading && agents.length === 0 ? (
          <Bullseye>
            <Spinner size="xl" />
          </Bullseye>
        ) : error && agents.length === 0 ? (
          <EmptyState>
            <EmptyStateHeader
              titleText="Unable to load agents"
              headingLevel="h2"
              icon={<EmptyStateIcon icon={CubesIcon} />}
            />
            <EmptyStateBody>{error}</EmptyStateBody>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: '380px' }}>
            {agents.map((agent) => (
              <GalleryItem key={agent.name}>
                <AgentMapCard agent={agent} />
              </GalleryItem>
            ))}
          </Gallery>
        )}
      </PageSection>
    </>
  );
};

export default MapPage;
