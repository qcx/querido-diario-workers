import React from 'react';

export default function Admin() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Admin Panel</h1>
      <p>System administration</p>
      <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2 style={{ marginTop: 0 }}>Admin Controls</h2>
        <p>Manage system settings, monitor queues, and configure pipeline behavior.</p>
        <div style={{ marginTop: '15px' }}>
          <h3>Quick Actions</h3>
          <ul>
            <li>View Queue Status</li>
            <li>Manage Spider Configurations</li>
            <li>Configure Webhook Subscriptions</li>
            <li>View System Logs</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

