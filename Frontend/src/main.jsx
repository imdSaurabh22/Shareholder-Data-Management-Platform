import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Login from "./Login.jsx";
import Signup from "./Signup.jsx";

function Root() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("authToken"));
  const [showSignup, setShowSignup] = useState(false);

  if (loggedIn) return <App />;
  if (showSignup) return <Signup onBackToLogin={() => setShowSignup(false)} />;
  return <Login onLogin={() => setLoggedIn(true)} onOpenSignup={() => setShowSignup(true)} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
