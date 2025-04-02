// Custom entry point to bypass Bun's welcome page
process.env.BUN_DISABLE_WELCOME = "true";

// Import and run the server
import('./src/server.js');

console.log("Starting Periscope MEV Dashboard...");
