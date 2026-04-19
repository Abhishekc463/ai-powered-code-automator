/**
 * AI Polling Agent
 * 
 * This agent monitors Linear for tickets with the "Abhishek c" label.
 * When found, it automatically triggers the AI pipeline.
 * No ngrok or webhooks required!
 */
import dotenv from 'dotenv';
dotenv.config();

import { LinearClient } from '@linear/sdk';
import { runPipeline } from '../pipeline/orchestrator.js';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';

const log = createLogger('PollingAgent');

// Track processed tickets to avoid re-processing
const processedTickets = new Set();
const POLL_INTERVAL_MS = 60000; // Check every 60 seconds

async function poll() {
  log.info(`Checking Linear for tickets with label: "${config.linear.triggerLabel}"...`);

  try {
    const linear = new LinearClient({ apiKey: config.linear.apiKey });
    
    // Fetch issues with the trigger label
    const issues = await linear.issues({
      filter: {
        labels: { name: { eq: config.linear.triggerLabel } },
        state: { name: { neq: 'Done' } } // Only active tickets
      }
    });

    const activeTickets = issues.nodes;
    log.info(`Found ${activeTickets.length} ticket(s) with the label.`);

    for (const ticket of activeTickets) {
      if (processedTickets.has(ticket.id)) {
        continue;
      }

      log.info(`🚀 Starting pipeline for ticket: ${ticket.identifier} — "${ticket.title}"`);
      
      try {
        // Run the pipeline (orchestrator handles GitHub and AI)
        await runPipeline(ticket.id);
        
        // Mark as processed
        processedTickets.add(ticket.id);
        
        // Optional: Remove the label after processing so it doesn't clutter Linear
        // await ticket.removeLabel(config.linear.triggerLabel);
        
        log.info(`✅ Pipeline finished for ${ticket.identifier}`);
      } catch (err) {
        log.error(`❌ Pipeline failed for ${ticket.identifier}: ${err.message}`);
        // We'll try again next poll if it failed
      }
    }

  } catch (err) {
    log.error(`Polling error: ${err.message}`);
  }

  const timestamp = new Date().toLocaleTimeString();
  process.stdout.write(`\r🤖 [Agent Heartbeat] Last check: ${timestamp} | Status: Active and Monitoring...    `);
  
  setTimeout(poll, POLL_INTERVAL_MS);
}

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║             🤖 AI Polling Agent                   ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log(`║  Monitoring: Linear tickets with label "${config.linear.triggerLabel}"`);
console.log(`║  Interval:   Every 60 seconds                      ║`);
console.log('╚═══════════════════════════════════════════════════╝');

// Start polling
poll();
