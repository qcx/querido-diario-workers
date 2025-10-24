import React from 'react';

export default function Dashboard() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Goodfellow Dashboard</h1>
      <p>Gazette processing pipeline overview</p>
      <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2 style={{ marginTop: 0 }}>Pipeline Status</h2>
        <p>Monitor your gazette crawling, OCR processing, analysis, and webhook delivery.</p>
      </div>
    </div>
  );
}

