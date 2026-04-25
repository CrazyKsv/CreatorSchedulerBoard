# Goal

I use Claude Design creating a post-login page for this project frontend

Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/6yGzvazX4fCz3jUpbp8Bzw?open_file=index.html
Implement: index.html

This Frontend has the following user interaction

- As an User, i should be able to create a series
  - Creation of series should follow the frontend flow
  - Frontend check the violate the 15-minute cadence rule But we also need to make sure we have this in backend
- As an User, I should be able to Modify my series
  - Update content in a series for each
  - Create new post under a series
  - Deletion of the series should follow the following rules in ./plan/series-and-post-delete-rules.md

All supported actions from user for post and series related should be integrated with the Backend -- WE ALSO NEED TO UPDATE THE BACKEND AND DB CORRESPONDINGLY

# What need to be consider

- Backend Integration.
  - pec 002 makes V1 for functional parts, now we should be in V2 that take user experience into consideration!
- Series Deletion should support delete the whole series
- Series Deletion should support delete the post in the series
  - But it should do soft delete for published one and let user know this would just be soft delete and can recover
  - Do hard delete for draft/failed/scheduled
- Schema Needs to be updated based on the frontend content
  - DB schema
  - APIs

# PLEASE ASK ENOUGH QUESTION FROM ME TO GATHER THE RIGHT REQUIREMENTS
