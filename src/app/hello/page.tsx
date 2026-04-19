import type { ReactNode } from 'react';

const Hello = () => {
  return (
    <div className="hello">
      <h1>Welcome to AI PR Pipeline!</h1>
      <p>This is a beautiful and welcoming page.</p>
      <style jsx>{
        `.hello {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background-image: linear-gradient(to bottom, #f7f7f7, #e7e7e7);
        }
      `}</style>
    </div>
  );
};

export default Hello;