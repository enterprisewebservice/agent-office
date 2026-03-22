import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Brand,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadMain,
  MastheadToggle,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSection,
  PageToggleButton,
} from '@patternfly/react-core';
import { BarsIcon } from '@patternfly/react-icons';

import '@patternfly/react-core/dist/styles/base.css';

import OfficePage from './pages/OfficePage';
import CreatePage from './pages/CreatePage';
import SettingsPage from './pages/SettingsPage';
import VisualOfficePage from './pages/VisualOfficePage';

const App: React.FC = () => {
  const location = useLocation();

  const headerNav = (
    <Nav variant="horizontal">
      <NavList>
        <NavItem isActive={location.pathname === '/' || location.pathname === '/create'}>
          <Link to="/">Office</Link>
        </NavItem>
        <NavItem isActive={location.pathname === '/visual'}>
          <Link to="/visual">Visual Office</Link>
        </NavItem>
        <NavItem isActive={location.pathname === '/settings'}>
          <Link to="/settings">Settings</Link>
        </NavItem>
      </NavList>
    </Nav>
  );

  const masthead = (
    <Masthead>
      <MastheadToggle>
        <PageToggleButton variant="plain" aria-label="Global navigation">
          <BarsIcon />
        </PageToggleButton>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand>
          <Brand
            src=""
            alt="Agent Office"
            heights={{ default: '36px' }}
          >
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white' }}>
              Agent Office
            </span>
          </Brand>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>{headerNav}</MastheadContent>
    </Masthead>
  );

  return (
    <Page header={masthead}>
      <PageSection padding={{ default: 'noPadding' }}>
        <Routes>
          <Route path="/" element={<OfficePage />} />
          <Route path="/visual" element={<VisualOfficePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </PageSection>
    </Page>
  );
};

export default App;
