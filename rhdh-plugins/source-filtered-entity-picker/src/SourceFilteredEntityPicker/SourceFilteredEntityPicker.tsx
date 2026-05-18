/*
 * SourceFilteredEntityPicker — a scaffolder field extension that
 * wraps the catalog's `EntityPicker` with a filter-icon affordance.
 *
 * Use case: the agent-office operator emits Backstage `Resource`
 * entities for every ml-model it knows about, tagged either
 * `model-registry` or `model-catalog` depending on whether the
 * model came from RHOAI's per-instance Model Registry or the
 * Red Hat-curated Model Catalog. The template's `baseModel` field
 * needs to let workshop attendees narrow the dropdown to one
 * source without typing — a single filter-icon button next to the
 * picker opens a popover with one checkbox per source.
 *
 * The component composes (rather than reimplements) the underlying
 * EntityPicker so all of its behavior (search, validation,
 * allowArbitraryValues, openCatalogLink, etc.) is preserved.
 * We pass through every `uiSchema['ui:options']` field except
 * `catalogFilter`, which we *augment* with the user's source
 * selections from the popover.
 */

import React from 'react';
import { Entity } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import {
  EntityPicker,
  EntityPickerProps,
} from '@backstage/plugin-scaffolder-react/alpha';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import IconButton from '@material-ui/core/IconButton';
import Popover from '@material-ui/core/Popover';
import FormGroup from '@material-ui/core/FormGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import Checkbox from '@material-ui/core/Checkbox';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';
import Tooltip from '@material-ui/core/Tooltip';
import Chip from '@material-ui/core/Chip';
import Divider from '@material-ui/core/Divider';
import FilterListIcon from '@material-ui/icons/FilterList';
import { makeStyles } from '@material-ui/core/styles';
import { useAsync } from 'react-use';

const useStyles = makeStyles(theme => ({
  // Wrap the picker + filter button in a flex row. The button sits
  // to the right of the picker at full height; matching how RHDH's
  // catalog page surfaces its filter sidebar trigger.
  wrapper: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    width: '100%',
  },
  pickerColumn: {
    flex: 1,
    minWidth: 0,
  },
  filterButton: {
    marginTop: theme.spacing(3),
  },
  popoverContent: {
    padding: theme.spacing(2),
    minWidth: 260,
  },
  countChip: {
    marginLeft: theme.spacing(1),
    height: 18,
    fontSize: 11,
  },
  emptyState: {
    color: theme.palette.text.secondary,
    fontStyle: 'italic',
    paddingTop: theme.spacing(1),
  },
  activeBadge: {
    backgroundColor: theme.palette.secondary.main,
    color: theme.palette.secondary.contrastText,
    fontSize: 10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    padding: '0 6px',
    marginLeft: 4,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

// Each option in the popover corresponds to one value the operator
// emits via the `agentoffice.ai/model-source` annotation. Right
// now there are exactly two; new sources will appear here on their
// own as soon as the operator emits them, no plugin redeploy needed.
type SourceOption = {
  // The annotation value we match against (e.g. "model-registry").
  value: string;
  // What we show in the popover row.
  label: string;
  // Number of entities with this source — surfaced as a Chip beside
  // the label so the user knows what they're filtering out.
  count: number;
};

// What our component reads out of `uiSchema['ui:options']`. We extend
// the stock EntityPicker options with one new key.
type SourceFilteredEntityPickerOptions = NonNullable<
  EntityPickerProps['uiSchema']['ui:options']
> & {
  /**
   * Annotation name carrying the source identifier on each entity.
   * Defaults to `agentoffice.ai/model-source` — change this if you
   * embed this plugin into a context that names sources differently.
   */
  sourceAnnotation?: string;
  /**
   * Optional human-readable label overrides per source value, e.g.
   *   sourceLabels:
   *     model-registry: "Model Registry"
   *     model-catalog:  "Model Catalog"
   * Sources we encounter that aren't listed here fall back to the
   * raw annotation value (kebab-cased).
   */
  sourceLabels?: Record<string, string>;
};

export const SourceFilteredEntityPicker = (
  props: FieldExtensionComponentProps<string>,
) => {
  const classes = useStyles();
  const catalogApi = useApi(catalogApiRef);

  const uiOptions =
    ((props.uiSchema?.['ui:options'] ?? {}) as SourceFilteredEntityPickerOptions);
  const sourceAnnotation =
    uiOptions.sourceAnnotation ?? 'agentoffice.ai/model-source';
  const sourceLabels = uiOptions.sourceLabels ?? {
    'model-registry': 'Model Registry',
    'model-catalog': 'Model Catalog',
  };

  // The set of source values the user has selected in the popover.
  // `null` (the initial state) means "no filter applied" — every
  // entity is allowed through. An empty Set means "no sources are
  // allowed" — picker is intentionally empty.
  const [selectedSources, setSelectedSources] = React.useState<Set<string> | null>(
    null,
  );

  // Popover open state (anchored to the filter button).
  const [anchorEl, setAnchorEl] = React.useState<HTMLButtonElement | null>(null);

  // Resolve the underlying catalogFilter so we know what kinds of
  // entities EntityPicker is about to fetch. We re-query the catalog
  // with the SAME filter and then summarise their sources, so the
  // popover only shows sources that are actually present in the
  // current scope. (For our karpathy template that means Resource +
  // spec.type=ml-model; the popover only lists model-registry /
  // model-catalog and never something unrelated like "rhel-vms".)
  const { value: sourceOptions = [], loading: sourcesLoading } = useAsync(async (): Promise<SourceOption[]> => {
    const filter = uiOptions.catalogFilter as
      | Record<string, string | string[]>
      | Record<string, string | string[]>[]
      | undefined;
    // catalogApi.getEntities supports the same filter shape as
    // catalogFilter in the UI options — pass it through verbatim.
    const result = await catalogApi.getEntities(
      filter ? { filter: filter as any } : undefined,
    );
    const counts = new Map<string, number>();
    for (const e of result.items as Entity[]) {
      const v = e.metadata?.annotations?.[sourceAnnotation];
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({
        value,
        label: sourceLabels[value] ?? value,
        count,
      }));
  }, [
    catalogApi,
    sourceAnnotation,
    JSON.stringify(uiOptions.catalogFilter),
    JSON.stringify(sourceLabels),
  ]);

  // When the user toggles a checkbox we update the selection set.
  // First toggle (from null → Set) starts WITH the toggled source
  // selected, mirroring how filter sidebars usually behave.
  const toggleSource = (value: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev ?? []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const clearFilter = () => setSelectedSources(null);

  // Compose the catalogFilter that's actually passed to EntityPicker.
  // - When `selectedSources` is null → forward the base filter as-is.
  // - When the user has selected one or more sources → OR-them by
  //   producing multiple filter objects (an array in catalogFilter is
  //   union semantics in Backstage's catalog API).
  // - When the user has selected zero sources → produce a filter
  //   that matches nothing so the picker shows empty (consistent
  //   with the popover's visible state).
  const effectiveCatalogFilter = React.useMemo(() => {
    const base = uiOptions.catalogFilter;
    if (selectedSources === null) return base;
    if (selectedSources.size === 0) {
      // Sentinel "match nothing": filter on an annotation that no
      // entity will carry. Keeps EntityPicker happy without
      // requiring a separate "show no items" code path.
      return [
        {
          ...(base && !Array.isArray(base) ? base : {}),
          [`metadata.annotations.${sourceAnnotation}`]: '__none__',
        },
      ];
    }
    const sources = Array.from(selectedSources);
    // Build one filter object per source value, each inheriting the
    // base filter fields. EntityPicker accepts an array — Backstage
    // treats it as an OR across the array members.
    const baseObj =
      base && !Array.isArray(base) ? (base as Record<string, unknown>) : undefined;
    return sources.map(v => ({
      ...(baseObj ?? {}),
      [`metadata.annotations.${sourceAnnotation}`]: v,
    }));
  }, [uiOptions.catalogFilter, selectedSources, sourceAnnotation]);

  // Build the uiSchema we forward to the wrapped EntityPicker —
  // identical to the user's input but with our composed
  // catalogFilter substituted in. Important: we shallow-copy
  // ui:options so the original schema object stays untouched.
  const wrappedUiSchema: typeof props.uiSchema = {
    ...props.uiSchema,
    'ui:options': {
      ...(props.uiSchema?.['ui:options'] ?? {}),
      catalogFilter: effectiveCatalogFilter,
    },
  };

  const activeCount =
    selectedSources === null ? 0 : selectedSources.size;

  return (
    <div className={classes.wrapper}>
      <div className={classes.pickerColumn}>
        <EntityPicker
          {...(props as unknown as EntityPickerProps)}
          uiSchema={wrappedUiSchema as EntityPickerProps['uiSchema']}
        />
      </div>
      <Tooltip
        title={
          activeCount > 0
            ? `Filtering by ${activeCount} source${activeCount === 1 ? '' : 's'}`
            : 'Filter by source'
        }
      >
        <IconButton
          aria-label="Filter by source"
          onClick={event => setAnchorEl(event.currentTarget)}
          className={classes.filterButton}
          color={activeCount > 0 ? 'secondary' : 'default'}
          size="medium"
        >
          <FilterListIcon />
          {activeCount > 0 && (
            <span className={classes.activeBadge}>{activeCount}</span>
          )}
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box className={classes.popoverContent}>
          <Typography variant="subtitle2">Filter by source</Typography>
          <Typography variant="caption" color="textSecondary">
            Narrow the dropdown to one or more model sources.
          </Typography>
          <Box mt={1} mb={1}>
            <Divider />
          </Box>
          {sourcesLoading && (
            <Typography className={classes.emptyState} variant="body2">
              Loading sources…
            </Typography>
          )}
          {!sourcesLoading && sourceOptions.length === 0 && (
            <Typography className={classes.emptyState} variant="body2">
              No source annotations found on the entities in scope.
            </Typography>
          )}
          {!sourcesLoading && sourceOptions.length > 0 && (
            <FormGroup>
              {sourceOptions.map(opt => {
                const checked =
                  selectedSources !== null && selectedSources.has(opt.value);
                return (
                  <FormControlLabel
                    key={opt.value}
                    control={
                      <Checkbox
                        checked={checked}
                        onChange={() => toggleSource(opt.value)}
                        color="primary"
                      />
                    }
                    label={
                      <>
                        {opt.label}
                        <Chip
                          label={opt.count}
                          size="small"
                          className={classes.countChip}
                        />
                      </>
                    }
                  />
                );
              })}
            </FormGroup>
          )}
          {selectedSources !== null && (
            <Box mt={1}>
              <Divider />
              <Box mt={1}>
                <Typography
                  variant="caption"
                  color="primary"
                  style={{ cursor: 'pointer' }}
                  onClick={clearFilter}
                >
                  Clear filter
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      </Popover>
    </div>
  );
};
