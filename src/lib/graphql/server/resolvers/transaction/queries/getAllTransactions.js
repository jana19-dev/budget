import { isAuthenticated } from "$lib/utils/server/authorization"
import fuzzySearchBuilder from "$lib/utils/server/fuzzySearchBuilder"
import { QUERY_LIMIT } from "$lib/utils/constants"

export default async function handler(parent, args, context) {
  // permissions
  isAuthenticated(context.user)

  const authUser = await context.prisma.user.findUnique({
    where: {
      email: context.user.email
    },
    select: {
      id: true
    }
  })

  const {
    search,
    searchField,
    subSearchField,
    skip = 0,
    orderBy = [{ date: `desc` }, { id: `desc` }]
  } = args

  const where = { userId: authUser.id }

  // include fuzzy search filters
  if (search) {
    where.OR = [
      ...fuzzySearchBuilder.transactions(search, searchField, subSearchField),
      {
        AND: search.split(` `).map((word) => ({
          OR: fuzzySearchBuilder.transactions(word, searchField, subSearchField)
        }))
      }
    ]
  }

  // setup response
  const response = {
    metrics: {
      skip
    },
    data: []
  }

  // get metrics
  const allCountPromise = context.prisma.transaction.count({
    where: { userId: authUser.id }
  })
  const filteredCountPromise = context.prisma.transaction.count({ where })

  // get sum of filtered transactions
  const filteredSumPromise = context.prisma.transaction
    .aggregate({
      where,
      _sum: {
        amount: true
      }
    })
    .then((result) => result._sum.amount)

  orderBy.push({ id: `asc` })
  const dataPromise = context.prisma.transaction.findMany({
    where,
    orderBy,
    skip,
    take: QUERY_LIMIT,
    select: {
      id: true,
      date: true,
      account: {
        select: {
          id: true,
          name: true
        }
      },
      category: {
        select: {
          id: true,
          name: true
        }
      },
      payee: {
        select: {
          id: true,
          name: true
        }
      },
      transferTo: {
        select: {
          account: {
            select: {
              id: true,
              name: true
            }
          }
        }
      },
      amount: true,
      memo: true
    }
  })

  // wait for all promises to resolve
  const [allCount, filteredCount, filteredSum, data] = await Promise.all([
    allCountPromise,
    filteredCountPromise,
    filteredSumPromise,
    dataPromise
  ])

  // add metrics to response
  response.metrics.allCount = allCount
  response.metrics.filteredCount = filteredCount
  response.metrics.filteredSum = filteredSum

  // add data to response
  response.data = data

  return response
}
