import React from 'react';

export default function Reports() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Reports</h1>
      <p>Processing reports and analytics</p>
      <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2 style={{ marginTop: 0 }}>Available Reports</h2>
        <ul>
          <li>Crawl Success Rate</li>
          <li>OCR Processing Statistics</li>
          <li>Analysis Findings Summary</li>
          <li>Webhook Delivery Logs</li>
        </ul>
      </div>
    </div>
  );
}

