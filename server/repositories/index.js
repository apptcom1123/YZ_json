// Repository Index - 集中管理所有 repositories
export { BaseRepository } from './BaseRepository.js';
export { UserRepository } from './UserRepository.js';
export { NoteRepository } from './NoteRepository.js';
export { DivinationRepository } from './DivinationRepository.js';
export { NoteReplyRepository } from './NoteReplyRepository.js';
export { NotificationRepository } from './NotificationRepository.js';

let repositories = {};

export function initRepositories(db) {
  repositories = {
    user: new (require('./UserRepository.js').UserRepository)(db),
    note: new (require('./NoteRepository.js').NoteRepository)(db),
    divination: new (require('./DivinationRepository.js').DivinationRepository)(db),
    reply: new (require('./NoteReplyRepository.js').NoteReplyRepository)(db),
    notification: new (require('./NotificationRepository.js').NotificationRepository)(db)
  };
  return repositories;
}

export function getRepositories() {
  if (Object.keys(repositories).length === 0) {
    throw new Error('Repositories not initialized. Call initRepositories first.');
  }
  return repositories;
}
