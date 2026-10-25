# Arun K. — QA Road Trip Portfolio

An interactive React + Vite portfolio with a racing-game visual theme, an S-shaped career track, clickable career stops, keyboard navigation, and resume-based QA content. A small Node.js server powers the local development preview and stores contact submissions.

## Features
- Move between six stops using **Arrow Up / Arrow Down / Arrow Left / Arrow Right** or the on-screen controls.
- Click the road markers, left progress rail, or top navigation to jump to a section.
- Stop details open in a centered popup when the car reaches a stop; click a track stop to reopen the details.
- Download the resume from the track controls or open the contact form from the track's pit-lane stop.
- Contact submissions require consent and are stored in `data/contact-submissions.json`, which is excluded from Git.
- Explore skill details in the Skill Garage.
- Responsive layout for desktop, tablet, and mobile; respects reduced-motion preferences.
- Resume PDF included in the project root.

## Requirements
- Node.js 18+ (Node.js 20+ recommended)
- npm

## Run locally
```bash
npm install
npm run dev
```
Open the local URL printed by the server (typically `http://localhost:5173`). The dev server serves the Vite app and the contact API together. If the default port is busy, it tries the next available port.

## Production build
```bash
npm run build
npm start
```
The production Node.js server serves the built site and contact API from the same origin. Set `PORT` to select a port. Contact submissions are written to the server's `data` folder; back up that folder securely and do not expose it as a static asset.

## Hosting and contact data
This project is configured to run locally. To make it public, deploy the Node.js server to a host that supports persistent storage and attach a persistent volume for the `data` folder. Static/serverless hosting such as a basic Vercel or Netlify deployment will not preserve this JSON file; use a managed database or persistent server volume before deploying there. Contact submissions contain personal information and are stored only after the visitor checks the consent box and submits the form.

## Resume content
Portfolio content is based on the supplied resume. Skill-bar percentages are illustrative UI ratings, not verified proficiency assessments. Replace contact details or revise content in `src/main.jsx` if needed.
