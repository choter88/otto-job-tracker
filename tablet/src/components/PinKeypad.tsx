import "../styles/keypad.css";

interface PinKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
}

export function PinKeypad({ onDigit, onBackspace }: PinKeypadProps) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

  return (
    <div className="keypad">
      {keys.map((key, i) => {
        if (key === "") return <div key={i} className="keypad-btn empty" />;
        if (key === "back") {
          return (
            <button key={i} className="keypad-btn backspace" onClick={onBackspace} type="button">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
            </button>
          );
        }
        return (
          <button key={i} className="keypad-btn" onClick={() => onDigit(key)} type="button">
            {key}
          </button>
        );
      })}
    </div>
  );
}
