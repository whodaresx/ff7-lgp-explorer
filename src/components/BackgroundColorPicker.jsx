import { useRef } from 'react';
import './BackgroundColorPicker.css';

export function BackgroundColorPicker({ value, onChange }) {
    const inputRef = useRef(null);

    const handleClick = () => {
        inputRef.current?.click();
    };

    return (
        <div className="bg-color-picker">
            <button
                className="bg-color-btn"
                onClick={handleClick}
                title="Change background color"
                style={{ backgroundColor: value }}
            >
                <span className="bg-color-icon">&#9632;</span>
            </button>
            <input
                ref={inputRef}
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="bg-color-input"
            />
        </div>
    );
}
