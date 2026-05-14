import { createRoot } from 'react-dom/client';
import App from './App';
import './tauri-deskoy-api';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(<App />);
