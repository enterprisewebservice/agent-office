import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  FormHelperText,
  Gallery,
  GalleryItem,
  HelperText,
  HelperTextItem,
  PageSection,
  Radio,
  Switch,
  TextArea,
  TextInput,
  Title,
  Wizard,
  WizardStep,
} from '@patternfly/react-core';

import type { CreateAgentRequest, SmallModelRouter } from '../types';
import { createAgent, fetchRouters } from '../api';

const EMOJI_OPTIONS = [
  '\u{1F916}', '\u{1F9E0}', '\u{1F4A1}', '\u{1F50D}', '\u{1F6E1}\uFE0F', '\u{1F4CA}', '\u{1F680}', '\u{1F4AC}',
  '\u{1F4DD}', '\u{1F3AF}', '\u26A1', '\u{1F527}', '\u{1F310}', '\u{1F4DA}', '\u{1F3A8}', '\u{1F3D7}\uFE0F',
  '\u{1F9EA}', '\u{1F52C}', '\u{1F468}\u200D\u{1F4BB}', '\u{1F469}\u200D\u{1F52C}', '\u{1F9BE}', '\u{1F91D}', '\u{1F4E1}', '\u{1F5C2}\uFE0F',
];

const TEMPLATES: Record<string, { displayName: string; emoji: string; description: string; prompt: string }> = {
  research: {
    displayName: 'Research Assistant',
    emoji: '\u{1F50D}',
    description: 'Literature review and data analysis',
    prompt:
      'You are a research assistant specializing in literature review and data analysis. Provide thorough, well-cited answers. When asked to research a topic, search for relevant sources and synthesize findings.',
  },
  code: {
    displayName: 'Code Reviewer',
    emoji: '\u{1F468}\u200D\u{1F4BB}',
    description: 'Review code for bugs and security issues',
    prompt:
      'You are a senior code reviewer. Review code for bugs, security issues, performance problems, and style. Be constructive and specific in your feedback.',
  },
  devops: {
    displayName: 'DevOps Monitor',
    emoji: '\u{1F4E1}',
    description: 'System health and incident response',
    prompt:
      'You are a DevOps monitoring assistant. Monitor system health, analyze logs, and suggest remediation steps for incidents. Prioritize critical issues.',
  },
  support: {
    displayName: 'Customer Support',
    emoji: '\u{1F91D}',
    description: 'Help users resolve issues',
    prompt:
      'You are a friendly customer support agent. Help users resolve their issues efficiently. Escalate complex problems when needed.',
  },
};

const AVAILABLE_TOOLS = [
  { key: 'web_search', label: 'Web Search', description: 'Search the web for information' },
  { key: 'web_fetch', label: 'Web Fetch', description: 'Fetch content from URLs' },
  { key: 'exec', label: 'Execute Commands', description: 'Run shell commands in a sandbox' },
  { key: 'sessions_send', label: 'Session Send', description: 'Send messages to other agents' },
  { key: 'memory', label: 'Memory', description: 'Persist information across conversations' },
];

function toK8sName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

const CreatePage: React.FC = () => {
  const navigate = useNavigate();

  // Step 1: Identity
  const [displayName, setDisplayName] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('\u{1F916}');
  const [description, setDescription] = useState('');

  // Step 2: Personality
  const [systemPrompt, setSystemPrompt] = useState('');

  // Step 3: LLM Backend
  const [backendType, setBackendType] = useState<'direct' | 'smr'>('smr');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [routers, setRouters] = useState<SmallModelRouter[]>([]);
  const [selectedRouter, setSelectedRouter] = useState<string>('');
  const [routersLoading, setRoutersLoading] = useState(false);
  const [routersError, setRoutersError] = useState<string | null>(null);

  // Step 4: Tools
  const [tools, setTools] = useState<Record<string, boolean>>({
    web_search: false,
    web_fetch: false,
    exec: false,
    sessions_send: false,
    memory: false,
  });

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-generate k8s name from display name
  useEffect(() => {
    if (displayName) {
      setName(toK8sName(displayName));
    }
  }, [displayName]);

  // Fetch routers when backend type changes to SMR
  useEffect(() => {
    if (backendType === 'smr') {
      setRoutersLoading(true);
      setRoutersError(null);
      fetchRouters()
        .then((data) => {
          setRouters(data);
          if (data.length > 0 && !selectedRouter) {
            setSelectedRouter(data[0].name);
          }
        })
        .catch((err) => {
          setRoutersError(err instanceof Error ? err.message : 'Failed to fetch routers');
        })
        .finally(() => setRoutersLoading(false));
    }
  }, [backendType, selectedRouter]);

  const applyTemplate = (key: string) => {
    const tpl = TEMPLATES[key];
    if (tpl) {
      setSystemPrompt(tpl.prompt);
      if (!displayName) {
        setDisplayName(tpl.displayName);
        setEmoji(tpl.emoji);
        setDescription(tpl.description);
      }
    }
  };

  const toggleTool = (key: string) => {
    setTools((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    const enabledTools = Object.entries(tools)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);

    const req: CreateAgentRequest = {
      name,
      displayName,
      emoji,
      description,
      systemPrompt,
      provider: backendType === 'smr' ? 'smr' : provider,
      modelName: backendType === 'smr' ? 'auto' : modelName,
      routerRef: backendType === 'smr' ? selectedRouter : undefined,
      apiKey: backendType === 'direct' ? apiKey : undefined,
      tools: enabledTools,
    };

    try {
      await createAgent(req);
      navigate('/');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create agent');
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="2xl">
          Create Agent
        </Title>
      </PageSection>
      <PageSection>
        {submitError && (
          <Alert variant="danger" title="Creation failed" style={{ marginBottom: '1rem' }}>
            {submitError}
          </Alert>
        )}
        <Wizard
          onClose={() => navigate('/')}
          onSave={handleSubmit}
          height={600}
        >
          {/* Step 1: Identity */}
          <WizardStep name="Identity" id="step-identity">
            <Form>
              <FormGroup label="Display Name" isRequired fieldId="display-name">
                <TextInput
                  id="display-name"
                  isRequired
                  value={displayName}
                  onChange={(_e, val) => setDisplayName(val)}
                  placeholder="My Research Agent"
                />
              </FormGroup>
              <FormGroup label="Name" fieldId="name">
                <TextInput
                  id="name"
                  value={name}
                  onChange={(_e, val) => setName(val)}
                  placeholder="my-research-agent"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Kubernetes-friendly name. Auto-generated from display name.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
              <FormGroup label="Emoji" fieldId="emoji">
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(8, 1fr)',
                    gap: '0.5rem',
                    maxWidth: '400px',
                  }}
                >
                  {EMOJI_OPTIONS.map((e) => (
                    <Button
                      key={e}
                      variant={emoji === e ? 'primary' : 'secondary'}
                      onClick={() => setEmoji(e)}
                      style={{ fontSize: '1.5rem', padding: '0.25rem' }}
                    >
                      {e}
                    </Button>
                  ))}
                </div>
              </FormGroup>
              <FormGroup label="Description" fieldId="description">
                <TextArea
                  id="description"
                  value={description}
                  onChange={(_e, val) => setDescription(val)}
                  placeholder="What does this agent do?"
                  rows={3}
                />
              </FormGroup>
            </Form>
          </WizardStep>

          {/* Step 2: Personality */}
          <WizardStep name="Personality" id="step-personality">
            <Form>
              <FormGroup label="Start from a template" fieldId="templates">
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  {Object.entries(TEMPLATES).map(([key, tpl]) => (
                    <Button key={key} variant="secondary" onClick={() => applyTemplate(key)}>
                      {tpl.emoji} {tpl.displayName}
                    </Button>
                  ))}
                </div>
              </FormGroup>
              <FormGroup label="System Prompt" isRequired fieldId="system-prompt">
                <TextArea
                  id="system-prompt"
                  isRequired
                  value={systemPrompt}
                  onChange={(_e, val) => setSystemPrompt(val)}
                  placeholder="You are a helpful assistant that..."
                  rows={12}
                  style={{ fontFamily: 'monospace' }}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      This defines your agent&apos;s personality, behavior, and capabilities.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </Form>
          </WizardStep>

          {/* Step 3: LLM Backend */}
          <WizardStep name="LLM Backend" id="step-backend">
            <Form>
              <FormGroup label="Backend Type" fieldId="backend-type">
                <Radio
                  id="radio-smr"
                  name="backend-type"
                  label="Small Model Router (recommended)"
                  description="Routes between local and cloud models intelligently. Reduces costs by using free local models for simple tasks."
                  isChecked={backendType === 'smr'}
                  onChange={() => setBackendType('smr')}
                />
                <Radio
                  id="radio-direct"
                  name="backend-type"
                  label="Direct API"
                  description="Connect directly to OpenAI or Anthropic APIs."
                  isChecked={backendType === 'direct'}
                  onChange={() => setBackendType('direct')}
                  style={{ marginTop: '0.75rem' }}
                />
              </FormGroup>

              {backendType === 'direct' && (
                <>
                  <FormGroup label="Provider" isRequired fieldId="provider">
                    <Radio
                      id="radio-openai"
                      name="provider"
                      label="OpenAI"
                      isChecked={provider === 'openai'}
                      onChange={() => {
                        setProvider('openai');
                        if (!modelName) setModelName('gpt-4o');
                      }}
                    />
                    <Radio
                      id="radio-anthropic"
                      name="provider"
                      label="Anthropic"
                      isChecked={provider === 'anthropic'}
                      onChange={() => {
                        setProvider('anthropic');
                        if (!modelName) setModelName('claude-sonnet-4-20250514');
                      }}
                      style={{ marginTop: '0.5rem' }}
                    />
                  </FormGroup>
                  <FormGroup label="API Key" isRequired fieldId="api-key">
                    <TextInput
                      id="api-key"
                      type="password"
                      isRequired
                      value={apiKey}
                      onChange={(_e, val) => setApiKey(val)}
                      placeholder="sk-..."
                    />
                  </FormGroup>
                  <FormGroup label="Model Name" isRequired fieldId="model-name">
                    <TextInput
                      id="model-name"
                      isRequired
                      value={modelName}
                      onChange={(_e, val) => setModelName(val)}
                      placeholder="gpt-4o"
                    />
                  </FormGroup>
                </>
              )}

              {backendType === 'smr' && (
                <>
                  {routersLoading && <p>Loading available routers...</p>}
                  {routersError && (
                    <Alert variant="warning" title="Could not load routers" isInline>
                      {routersError}
                    </Alert>
                  )}
                  {!routersLoading && !routersError && routers.length === 0 && (
                    <Alert variant="info" title="No SmallModelRouter found" isInline>
                      No SmallModelRouter found on the cluster. Deploy one first using the Small
                      Model Router operator.
                    </Alert>
                  )}
                  {routers.length > 0 && (
                    <FormGroup label="Select Router" fieldId="router-select">
                      <Gallery hasGutter minWidths={{ default: '250px' }}>
                        {routers.map((r) => (
                          <GalleryItem key={r.name}>
                            <Card
                              isClickable
                              isSelectable
                              isSelected={selectedRouter === r.name}
                              onClick={() => setSelectedRouter(r.name)}
                            >
                              <CardTitle>{r.name}</CardTitle>
                              <CardBody>
                                <p>Namespace: {r.namespace}</p>
                                <p>Status: {r.phase}</p>
                                <p style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                                  {r.endpoint}
                                </p>
                              </CardBody>
                            </Card>
                          </GalleryItem>
                        ))}
                      </Gallery>
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            Model will be set to &quot;auto&quot; &mdash; the router&apos;s semantic
                            classifier will pick the best model for each request.
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  )}
                  <div
                    style={{
                      marginTop: '1rem',
                      padding: '1rem',
                      borderRadius: '8px',
                      backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
                    }}
                  >
                    <strong>Cost savings hint:</strong> Using Smart Router can reduce costs by
                    routing simple tasks to free local models, while sending complex tasks to
                    powerful cloud models only when needed.
                  </div>
                </>
              )}
            </Form>
          </WizardStep>

          {/* Step 4: Tools & Review */}
          <WizardStep
            name="Tools & Review"
            id="step-review"
            footer={{
              nextButtonText: submitting ? 'Creating...' : 'Create Agent',
              isNextDisabled: submitting || !name || !displayName || !systemPrompt,
            }}
          >
            <Form>
              <FormGroup label="Tools" fieldId="tools">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {AVAILABLE_TOOLS.map((tool) => (
                    <Switch
                      key={tool.key}
                      id={`tool-${tool.key}`}
                      label={tool.label}
                      isChecked={tools[tool.key]}
                      onChange={() => toggleTool(tool.key)}
                    />
                  ))}
                </div>
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Enable tools this agent can use during conversations.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <Title headingLevel="h3" size="lg" style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                Review
              </Title>

              <Card>
                <CardBody>
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 0.5rem' }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 600, paddingRight: '2rem', verticalAlign: 'top' }}>
                          Name
                        </td>
                        <td>
                          {emoji} {displayName} ({name})
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600, paddingRight: '2rem', verticalAlign: 'top' }}>
                          Description
                        </td>
                        <td>{description || '(none)'}</td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600, paddingRight: '2rem', verticalAlign: 'top' }}>
                          System Prompt
                        </td>
                        <td>
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              fontSize: '0.85rem',
                              maxHeight: '120px',
                              overflow: 'auto',
                              background: 'var(--pf-t--global--background--color--secondary--default)',
                              padding: '0.5rem',
                              borderRadius: '4px',
                            }}
                          >
                            {systemPrompt || '(none)'}
                          </pre>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600, paddingRight: '2rem', verticalAlign: 'top' }}>
                          Backend
                        </td>
                        <td>
                          {backendType === 'smr'
                            ? `Smart Router: ${selectedRouter || '(none selected)'} / model=auto`
                            : `${provider} / ${modelName}`}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600, paddingRight: '2rem', verticalAlign: 'top' }}>
                          Tools
                        </td>
                        <td>
                          {Object.entries(tools)
                            .filter(([, v]) => v)
                            .map(([k]) => k)
                            .join(', ') || '(none)'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardBody>
              </Card>

              {submitting && (
                <p style={{ marginTop: '1rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                  Creating agent...
                </p>
              )}
            </Form>
          </WizardStep>
        </Wizard>
      </PageSection>
    </>
  );
};

export default CreatePage;
