import { useState, useEffect, useRef } from 'react';
import { checkForUpdate, installUpdate } from '../utils/updater.ts';
import './StatusBar.css';

export function StatusBar({ status, fileCount, totalSize, selectedCount, onSelectFile }) {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef(null);
  const triggerRef = useRef(null);

  // Check for updates on mount
  useEffect(() => {
    checkForUpdate().then((info) => {
      if (info) {
        setUpdateInfo(info);
        setShowPopover(true);
      }
    });
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    if (!showPopover) return;

    const handleClickOutside = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target)
      ) {
        setShowPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopover]);

  const handleUpdateClick = async () => {
    setIsUpdating(true);
    const success = await installUpdate();
    if (!success) {
      setIsUpdating(false);
    }
    // If successful, app will restart automatically
  };

  // Status can be a string or an object with { message, references }
  const renderStatus = () => {
    if (typeof status === 'string') {
      return status;
    }

    if (status && status.references && status.references.length > 0) {
      const { message, references } = status;
      return (
        <>
          {message}{' '}
          {references.map((filename, i) => (
            <span key={filename}>{i > 0 && ', '}<a
                href="#"
                className="status-link"
                onClick={(e) => {
                  e.preventDefault();
                  onSelectFile?.(filename);
                }}
              >{filename}</a></span>
          ))}
        </>
      );
    }

    return status?.message || '';
  };

  return (
    <div className="status-bar">
      <span className="status-item status-message">{renderStatus()}</span>
      <div className="status-right">
        {selectedCount > 0 && (
          <span className="status-item">Selected: {selectedCount}</span>
        )}
        <span className="status-item">Files: {fileCount.toLocaleString()}</span>
        <span className="status-item">Size: {totalSize}</span>
        {updateInfo && (
          <span className="status-item update-container">
            <button
              ref={triggerRef}
              className="update-trigger"
              onClick={() => setShowPopover(!showPopover)}
              title={`Update available: v${updateInfo.version}`}
            >
              <svg className="update-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            {showPopover && (
              <div ref={popoverRef} className="update-popover">
                <div className="update-popover-header">
                  New version available: v{updateInfo.version}
                </div>
                {updateInfo.date && (
                  <div className="update-popover-date">
                    Released: {updateInfo.date.split(' ')[0]}
                  </div>
                )}
                {updateInfo.body && (
                  <div className="update-popover-body">
                    {updateInfo.body}
                  </div>
                )}
                <div className="update-popover-actions">
                  <button
                    className="update-btn update-btn-dismiss"
                    onClick={() => setShowPopover(false)}
                    disabled={isUpdating}
                  >
                    Dismiss
                  </button>
                  <button
                    className="update-btn update-btn-install"
                    onClick={handleUpdateClick}
                    disabled={isUpdating}
                  >
                    {isUpdating ? 'Updating...' : 'Download & Install'}
                  </button>
                </div>
              </div>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
