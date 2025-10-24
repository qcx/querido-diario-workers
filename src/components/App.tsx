import React from 'react';
import { Route, Routes, Link } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Admin from './pages/Admin';

export default function App() {
  return (
    <div>
      <nav style={{ 
        padding: '15px 20px', 
        background: '#2c3e50', 
        color: 'white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ fontSize: '20px', fontWeight: 'bold' }}>Goodfellow</span>
          <div style={{ display: 'flex', gap: '15px' }}>
            <Link to="/dashboard" style={{ 
              color: 'white', 
              textDecoration: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}>Dashboard</Link>
            <Link to="/reports" style={{ 
              color: 'white', 
              textDecoration: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}>Reports</Link>
            <Link to="/admin" style={{ 
              color: 'white', 
              textDecoration: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}>Admin</Link>
          </div>
        </div>
      </nav>
      
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <h1>404 - Page not found</h1>
            <p>The page you're looking for doesn't exist.</p>
          </div>
        } />
      </Routes>
    </div>
  );
}

