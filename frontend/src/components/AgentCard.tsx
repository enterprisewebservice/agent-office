import React, { useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
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
      return provider;
  }
};

const AgentCard: React.FC<AgentCardProps> = ({ agent, onChat, onDeleted }) => {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
      <Card
        isClickable
        isSelectable
        style={{ minHeight: '200px', cursor: 'pointer' }}
      >
        <CardHeader>
          <CardTitle>
            <span style={{ fontSize: '1.5rem', marginRight: '0.5rem' }}>{agent.emoji}</span>
            {agent.displayName}
          </CardTitle>
        </CardHeader>
        <CardBody onClick={() => onChat(agent)}>
          <p style={{ marginBottom: '0.75rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
            {agent.description}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Label color="blue" isCompact>
              {providerLabel(agent.provider)}
            </Label>
            <Label color="purple" isCompact>
              {agent.modelName}
            </Label>
          </div>
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
                onClick={(e) => {
                  e.stopPropagation();
                  onChat(agent);
                }}
              >
                Chat
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<TrashIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeleteModalOpen(true);
                }}
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
        Are you sure you want to delete <strong>{agent.displayName}</strong>? This action cannot be
        undone.
      </Modal>
    </>
  );
};

export default AgentCard;
