import { TasksView } from '@/features/tasks/TasksView';

/** Home opens straight on the weekly calendar until the Dashboard module exists. */
export default function Home() {
  return <TasksView />;
}
