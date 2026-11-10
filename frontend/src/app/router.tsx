import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SetupPage } from '../features/setup/SetupPage'
import { ComparePage } from '../features/compare/ComparePage'
import { TripPage } from '../features/trip/TripPage'
import { Shell, NotFound, RouteError } from './Shell'

export const router = createBrowserRouter([{ element: <Shell />, errorElement: <RouteError />, children: [
  { path: '/', element: <Navigate to="/plan/new" replace /> },
  { path: '/plan/new', element: <SetupPage /> },
  { path: '/trips/:tripId/compare', element: <ComparePage /> },
  { path: '/trips/:tripId', element: <TripPage /> },
  { path: '*', element: <NotFound /> },
] }])
