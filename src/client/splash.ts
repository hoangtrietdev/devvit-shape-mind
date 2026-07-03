import { navigateTo, context, requestExpandedMode } from '@devvit/web/client';

const startButton = document.getElementById(
  'start-button'
) as HTMLButtonElement;
const docsLink = document.getElementById('docs-link') as HTMLDivElement;
const playtestLink = document.getElementById('playtest-link') as HTMLDivElement;
const discordLink = document.getElementById('discord-link') as HTMLDivElement;
const titleElement = document.getElementById('title') as HTMLHeadingElement;

// Greet the user if we have their username
if (context.username) {
  titleElement.textContent = `Hi ${context.username} 👋`;
}

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

docsLink.addEventListener('click', () => {
  navigateTo('https://developers.reddit.com/docs');
});

playtestLink.addEventListener('click', () => {
  navigateTo('https://www.reddit.com/r/Devvit');
});

discordLink.addEventListener('click', () => {
  navigateTo('https://discord.com/invite/R7yu2wh9Qz');
});
