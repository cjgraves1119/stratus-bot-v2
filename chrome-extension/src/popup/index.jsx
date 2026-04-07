import { createRoot } from 'react-dom/client';
import QuickActions from './QuickActions';
import '../styles/popup.css';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<QuickActions />);
