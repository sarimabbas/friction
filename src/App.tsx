import { useState, useEffect } from "react";
import { Carousel } from "./components/Carousel/Carousel";
import { LightSwitch } from "./components/LightSwitch/LightSwitch";
import { RotaryDial } from "./components/RotaryDial/RotaryDial";
import "./App.css";

function App() {
  const [isOn, setIsOn] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [dialValue, setDialValue] = useState(0);

  useEffect(() => {
    document.body.classList.toggle("room-lit", activePage === 0 && isOn);
    document.body.classList.toggle("dial-page", activePage === 1);
  }, [isOn, activePage]);

  return (
    <>
      <a
        className="repo-link"
        href="https://github.com/sarimabbas/friction"
        target="_blank"
        rel="noreferrer"
        aria-label="View source on GitHub"
      >
        github
      </a>
      <Carousel onPageChange={setActivePage}>
        <div className="page page--switch">
          <LightSwitch defaultOn={false} onChange={setIsOn} />
          <span className={`switch-label ${isOn ? "switch-label--on" : ""}`}>
            {isOn ? "ON" : "OFF"}
          </span>
        </div>
        <div className="page page--dial">
          <RotaryDial detents={11} defaultIndex={0} onChange={setDialValue} />
          <span className="dial-label">{dialValue}</span>
        </div>
      </Carousel>
    </>
  );
}

export default App;
