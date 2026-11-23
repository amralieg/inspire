import { createContext, useContext } from 'react';

// REQ-506: the side dock is gone; a record opens as a drawer. The context stays (always empty) because Records.jsx reads it.
export const DockContext = createContext(null);
export const useDock = () => useContext(DockContext);
