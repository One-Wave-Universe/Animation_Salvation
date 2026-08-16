import { UploadPanel } from './components/UploadPanel';
import { RigEditor } from './components/RigEditor';
import { InpaintPanel } from './components/InpaintPanel';
import { DirectorPanel } from './components/DirectorPanel';
import { ExportPanel } from './components/ExportPanel';
import { Viewport } from './components/Viewport';
import './App.css';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Character Animator</h1>
        <p>PNG → rigged character → AI-directed scene</p>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <UploadPanel />
          <RigEditor />
          <InpaintPanel />
          <DirectorPanel />
          <ExportPanel />
        </aside>
        <main>
          <Viewport />
        </main>
      </div>
    </div>
  );
}

export default App;
