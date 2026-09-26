import { useEffect } from 'react';
import './index.css';
import { LegacySettingsMarkup } from './components/settings/LegacySettingsMarkup';
import { attachDeskoyUi } from './legacy-ui';

export default function App() {
  useEffect(() => {
    attachDeskoyUi();
  }, []);

  return <LegacySettingsMarkup />;
}
