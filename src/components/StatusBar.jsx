import './StatusBar.css';

export function StatusBar({ status, fileCount, totalSize, selectedCount }) {
  return (
    <div className="status-bar">
      <span className="status-item status-message">{status}</span>
      <div className="status-right">
        {selectedCount > 0 && (
          <span className="status-item">Selected: {selectedCount}</span>
        )}
        <span className="status-item">Files: {fileCount.toLocaleString()}</span>
        <span className="status-item">Size: {totalSize}</span>
      </div>
    </div>
  );
}
