import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import HarnessApp from './HarnessApp.jsx';
import PermissionHost from '../../src/components/PermissionHost';

const params = new URLSearchParams(window.location.search);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PermissionHost />
    <HarnessApp
      open={params.get('open')}
      nest={params.get('nest') === '1'}
      discoveryType={params.get('discovery') || 'Standard Discovery'}
      step={params.get('step') || ''}
      run={params.get('run') || ''}
    />
  </StrictMode>,
);
