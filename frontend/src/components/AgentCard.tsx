import React, { useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  ExpandableSection,
  Label,
  Modal,
  ModalVariant,
} from '@patternfly/react-core';
import { TrashIcon, CommentsIcon } from '@patternfly/react-icons';

import type { Agent } from '../types';
import { deleteAgent } from '../api';

interface AgentCardProps {
  agent: Agent;
  onChat: (agent: Agent) => void;
  onDeleted: () => void;
}

const statusColor = (phase: string | undefined): 'green' | 'grey' | 'red' => {
  switch (phase?.toLowerCase()) {
    case 'running':
      return 'green';
    case 'error':
    case 'failed':
      return 'red';
    default:
      return 'grey';
  }
};

const providerLabel = (provider: string): string => {
  switch (provider) {
    case 'smr':
      return 'Smart Router';
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

const AgentCard: React.FC<AgentCardProps> = ({ agent, onChat, onDeleted }) => {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAgent(agent.name);
      setIsDeleteModalOpen(false);
      onDeleted();
    } catch (err) {
      console.error('Failed to delete agent:', err);
      setIsDeleting(false);
    }
  };

  const phase = agent.status?.phase ?? 'Stopped';

  return (
    <>
      <Card style={{ minHeight: '200px' }}>
        <CardHeader>
          <CardTitle>
            <span style={{ fontSize: '1.5rem', marginRight: '0.5rem' }}>
              {agent.emoji || '\u{1F916}'}
            </span>
            {agent.displayName || agent.name}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p style={{ marginBottom: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
            {agent.description || 'No description'}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <Label color="blue" isCompact>
              {providerLabel(agent.provider)}
            </Label>
            {agent.modelName && (
              <Label color="purple" isCompact>
                {agent.modelName}
              </Label>
            )}
            {agent.tools?.map((tool) => (
              <Label key={tool} color="cyan" isCompact>
                {tool}
              </Label>
            ))}
          </div>

          <ExpandableSection
            toggleText={isDetailsOpen ? 'Hide details' : 'Show details'}
            isExpanded={isDetailsOpen}
            onToggle={(_e, expanded) => setIsDetailsOpen(expanded)}
          >
            <DescriptionList isCompact isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Name</DescriptionListTerm>
                <DescriptionListDescription>{agent.name}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Provider</DescriptionListTerm>
                <DescriptionListDescription>{providerLabel(agent.provider)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Model</DescriptionListTerm>
                <DescriptionListDescription>{agent.modelName || 'auto'}</DescriptionListDescription>
              </DescriptionListGroup>
              {agent.systemPrompt && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Directive</DescriptionListTerm>
                  <DescriptionListDescription>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.85rem',
                      maxHeight: '200px',
                      overflow: 'auto',
                      background: 'var(--pf-t--global--background--color--secondary--default)',
                      padding: '0.5rem',
                      borderRadius: '4px',
                    }}>
                      {agent.systemPrompt}
                    </pre>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
              {agent.status?.gatewayEndpoint && (
                <DescriptionListGroup>
                  <DescriptionListTerm>Endpoint</DescriptionListTerm>
                  <DescriptionListDescription>
                    <code style={{ fontSize: '0.85rem' }}>{agent.status.gatewayEndpoint}</code>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              )}
            </DescriptionList>
          </ExpandableSection>
        </CardBody>
        <CardFooter>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <Label color={statusColor(phase)} isCompact>
              {phase}
            </Label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="secondary"
                size="sm"
                icon={<CommentsIcon />}
                onClick={() => onChat(agent)}
              >
                Chat
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<TrashIcon />}
                onClick={() => setIsDeleteModalOpen(true)}
              >
                Delete
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>

      <Modal
        variant={ModalVariant.small}
        title="Delete Agent"
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        actions={[
          <Button
            key="delete"
            variant="danger"
            onClick={handleDelete}
            isLoading={isDeleting}
            isDisabled={isDeleting}
          >
            Delete
          </Button>,
          <Button key="cancel" variant="link" onClick={() => setIsDeleteModalOpen(false)}>
            Cancel
          </Button>,
        ]}
      >
        Are you sure you want to delete <strong>{agent.displayName || agent.name}</strong>? This action cannot be undone.
      </Modal>
    </>
  );
};

export default AgentCard;
