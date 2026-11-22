/**
 * Runs the Game API v1 conformance suite: always against the SDK's mock API, and against a real Game Center when
 * FOBO_CONFORMANCE_URL, FOBO_CONFORMANCE_PK and FOBO_CONFORMANCE_SK are set (FOBO_CONFORMANCE_ORIGIN names the
 * game site the keys allow). With no environment the site half is skipped.
 */
import { describe } from 'node:test'
import { conformance } from './suite.ts'
import { DEFAULT_ORIGIN, mockTarget, siteTarget, stubPage } from './target.ts'

const site = siteTarget(process.env)
const origin = site?.origin ?? DEFAULT_ORIGIN

// the SDK's client is made for a page: give it one before any game is created
stubPage(origin)

conformance(mockTarget(origin))

if (site) conformance(site)
else describe('Game API v1: site', { skip: 'set FOBO_CONFORMANCE_URL, _PK and _SK to run it' }, () => undefined)
